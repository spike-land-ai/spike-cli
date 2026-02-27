/**
 * SSE transport for the MCP multiplexer server.
 * Uses Node.js built-in http module with MCP SDK's SSEServerTransport (legacy).
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { ServerManager } from "../multiplexer/server-manager";
import { log, warn } from "../util/logger";
import { createMcpServer } from "./http-server";

export interface SseServerOptions {
  port: number;
  apiKey?: string;
}

export async function startSseServer(
  manager: ServerManager,
  options: SseServerOptions,
): Promise<{ close: () => Promise<void>; }> {
  // Map of session ID → transport
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", tools: manager.getAllTools().length }),
        );
        return;
      }

      // API key validation
      if (options.apiKey) {
        const provided = req.headers["x-api-key"];
        if (provided !== options.apiKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      if (url.pathname === "/sse" && req.method === "GET") {
        // SSE connection endpoint — create new transport and server
        const transport = new SSEServerTransport("/messages", res);

        const server = createMcpServer(manager);
        await server.connect(transport);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };

        log(`SSE client connected: ${transport.sessionId}`);
        return;
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        // Message endpoint — route to the correct transport by session ID
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing sessionId" }));
          return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown session" }));
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Not found. Use GET /sse or POST /messages" }),
      );
    },
  );

  return new Promise((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(options.port, () => {
      warn(
        `MCP multiplexer (SSE) listening on http://localhost:${options.port}/sse`,
      );
      resolve({
        close: async () => {
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
