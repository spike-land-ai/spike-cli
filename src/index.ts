/**
 * Programmatic API for spike MCP multiplexer.
 */

export { ServerManager } from "./multiplexer/server-manager";
export { MultiplexerServer } from "./multiplexer/multiplexer-server";
export { UpstreamClient } from "./multiplexer/upstream-client";
export { discoverConfig, type DiscoveryOptions } from "./config/discovery";
export { validateConfig } from "./config/schema";
export {
  DEFAULT_SEPARATOR,
  namespaceTool,
  parseNamespacedTool,
  stripNamespace,
} from "./multiplexer/namespace";
export type {
  HttpServerConfig,
  McpConfigFile,
  ResolvedConfig,
  ServerConfig,
  StdioServerConfig,
} from "./config/types";
export type {
  CallToolResult,
  ToolInfo,
  UpstreamServer,
} from "./multiplexer/types";
export type { NamespacedTool } from "./multiplexer/server-manager";
export { setVerbose } from "./util/logger";
export { ChatClient, type ChatClientOptions } from "./chat/client";
export { executeToolCall, mcpToolsToClaude } from "./chat/tool-adapter";
export { type AgentLoopContext, runAgentLoop } from "./chat/loop";
