/**
 * Wraps the MCP SDK Client for a single upstream server.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ServerConfig } from "../config/types";
import { isHttpConfig, isStdioConfig } from "../config/types";
import type { CallToolResult, ToolInfo } from "./types";
import { log, warn } from "../util/logger";

export class UpstreamClient {
  readonly name: string;
  private client: Client;
  private config: ServerConfig;
  private tools: ToolInfo[] = [];
  private _connected = false;

  constructor(name: string, config: ServerConfig) {
    this.name = name;
    this.config = config;
    this.client = new Client(
      { name: `spike-mux-${name}`, version: "0.1.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    log(`Connecting to upstream: ${this.name}`);

    try {
      const transport = this.createTransport();
      await this.client.connect(transport);
      this._connected = true;

      // Discover tools
      const result = await this.client.listTools();
      this.tools = (result.tools ?? []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      if (this.tools.length === 0) {
        warn(
          `${this.name}: connected but discovered 0 tools — check auth token and server config`,
        );
      }

      log(`Connected to ${this.name}: ${this.tools.length} tools`);
    } catch (err) {
      this._connected = false;
      const message = err instanceof Error ? err.message : String(err);
      warn(`Failed to connect to ${this.name}: ${message}`);
      if (
        isHttpConfig(this.config)
        && (message.includes("401") || message.includes("403")
          || message.includes("Unauthorized"))
      ) {
        warn(
          `${this.name}: auth failure — verify SPIKE_AUTH_TOKEN env var is set and valid`,
        );
      }
      throw err;
    }
  }

  private createTransport():
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport {
    if (isStdioConfig(this.config)) {
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env
          ? {
            PATH: process.env.PATH,
            NODE_ENV: process.env.NODE_ENV,
            ...this.config.env
          } as Record<string, string>
          : undefined,
      });
    }

    if (isHttpConfig(this.config)) {
      const url = new URL(this.config.url);
      const authToken = this.config.env?.SPIKE_AUTH_TOKEN;
      const requestInit = authToken
        ? { headers: { Authorization: `Bearer ${authToken}` } }
        : undefined;

      if (this.config.type === "sse") {
        return new SSEClientTransport(url, { requestInit });
      }

      // Default to StreamableHTTP for "url" type
      return new StreamableHTTPClientTransport(url, { requestInit });
    }

    throw new Error(`Unknown server config type for ${this.name}`);
  }

  getTools(): ToolInfo[] {
    return this.tools;
  }

  get connected(): boolean {
    return this._connected;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (!this._connected) {
      throw new Error(`Upstream ${this.name} is not connected`);
    }

    log(`Calling ${this.name}/${toolName}`);
    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });
    return result as CallToolResult;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
      this._connected = false;
      log(`Closed upstream: ${this.name}`);
    } catch (err) {
      warn(
        `Error closing ${this.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
