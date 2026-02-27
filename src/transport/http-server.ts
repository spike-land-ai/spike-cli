/**
 * HTTP transport for the MCP multiplexer server.
 * Uses Node.js built-in http module with MCP SDK's StreamableHTTPServerTransport.
 */

import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerManager } from "../multiplexer/server-manager";
import { error as logError, log, warn } from "../util/logger";

export interface HttpServerOptions {
  port: number;
  apiKey?: string;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return timingSafeEqual(ab, bb);
}

export function createMcpServer(manager: ServerManager): Server {
  const server = new Server(
    { name: "spike-mcp-multiplexer", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerMcpHandlers(server, manager);
  return server;
}

function registerMcpHandlers(server: Server, manager: ServerManager): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = manager.getAllTools();
    return {
      tools: tools.map(t => ({
        name: t.namespacedName,
        description: t.description
          ? `[${t.serverName}] ${t.description}`
          : `[${t.serverName}] ${t.originalName}`,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    log(`Routing tool call: ${name}`);

    try {
      const result = await manager.callTool(
        name,
        (args ?? {}) as Record<string, unknown>,
      );
      return result as unknown as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Tool call failed: ${name} — ${message}`);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      } as Record<string, unknown>;
    }
  });
}

export async function startHttpServer(
  manager: ServerManager,
  options: HttpServerOptions,
): Promise<{ close: () => Promise<void>; }> {
  // Map to store transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );

      // Health check endpoint
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", tools: manager.getAllTools().length }),
        );
        return;
      }

      // Only handle /mcp path
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      // API key validation
      if (options.apiKey) {
        const provided = req.headers["x-api-key"];
        if (typeof provided !== "string" || !safeCompare(provided, options.apiKey)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      // Handle session management
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Try to get existing transport
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          // Create new transport and server for this session
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
          });

          const server = new Server(
            { name: "spike-mcp-multiplexer", version: "0.1.0" },
            { capabilities: { tools: {} } },
          );

          registerMcpHandlers(server, manager);

          await server.connect(transport);

          if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
          }

          transport.onclose = () => {
            if (transport!.sessionId) {
              transports.delete(transport!.sessionId);
            }
          };
        }

        await transport.handleRequest(req, res);
      } else if (req.method === "GET") {
        // Handle SSE stream for existing session
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "No session. Send POST /mcp first." }),
          );
          return;
        }
        await transport.handleRequest(req, res);
      } else if (req.method === "DELETE") {
        // Handle session termination
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (transport) {
          await transport.close();
          transports.delete(sessionId!);
        }
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
    },
  );

  return new Promise((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(options.port, () => {
      warn(`MCP multiplexer listening on http://localhost:${options.port}/mcp`);
      resolve({
        close: async () => {
          // Close all transports
          for (const transport of transports.values()) {
            await transport.close();
          }
          transports.clear();
          return new Promise<void>(res => httpServer.close(() => res()));
        },
      });
    });
  });
}
