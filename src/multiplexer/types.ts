/**
 * Shared types for the multiplexer layer.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface UpstreamServer {
  name: string;
  client: Client;
  tools: ToolInfo[];
  status: "connecting" | "connected" | "error" | "closed";
  error?: string;
}

export interface CallToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown; }>;
  isError?: boolean;
}
