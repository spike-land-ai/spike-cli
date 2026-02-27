/**
 * MCP Server that exposes unified tools from all upstream servers.
 * Uses the low-level Server API for dynamic tool registration.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerManager } from "./server-manager";
import { error as logError, log } from "../util/logger";

export class MultiplexerServer {
  private server: Server;
  private manager: ServerManager;

  constructor(manager: ServerManager) {
    this.manager = manager;

    this.server = new Server(
      { name: "spike-mcp-multiplexer", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // tools/list — aggregate all upstream tools with namespace prefixes
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.manager.getAllTools();
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

    // tools/call — route to correct upstream by namespace prefix
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;
      log(`Routing tool call: ${name}`);

      try {
        const result = await this.manager.callTool(
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

  async serve(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log("MultiplexerServer listening on stdio");
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
