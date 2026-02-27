/**
 * Manages lifecycle of all upstream MCP server connections.
 * Error isolation: one upstream crashing doesn't affect others.
 */

import type {
  ResolvedConfig,
  ServerConfig,
  ToolFilterConfig,
} from "../config/types";
import { UpstreamClient } from "./upstream-client";
import type { CallToolResult, ToolInfo } from "./types";
import {
  DEFAULT_SEPARATOR,
  namespaceTool,
  parseNamespacedTool,
} from "./namespace";
import { filterTools } from "../util/glob";
import type { ToolsetManager } from "./toolset-manager";
import { error as logError, log } from "../util/logger";

export interface NamespacedTool {
  namespacedName: string;
  originalName: string;
  serverName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class ServerManager {
  private upstreams = new Map<string, UpstreamClient>();
  private serverConfigs = new Map<string, ServerConfig>();
  private separator: string;
  private noPrefix: boolean;
  private _toolsetManager?: ToolsetManager;

  constructor(options: { separator?: string; noPrefix?: boolean; } = {}) {
    this.separator = options.separator ?? DEFAULT_SEPARATOR;
    this.noPrefix = options.noPrefix ?? false;
  }

  setToolsetManager(manager: ToolsetManager): void {
    this._toolsetManager = manager;
  }

  get toolsetManager(): ToolsetManager | undefined {
    return this._toolsetManager;
  }

  async connectAll(config: ResolvedConfig): Promise<void> {
    const entries = Object.entries(config.servers);
    log(`Connecting to ${entries.length} upstream servers...`);

    await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        const client = new UpstreamClient(name, serverConfig);
        try {
          await client.connect();
          this.upstreams.set(name, client);
          this.serverConfigs.set(name, serverConfig);
        } catch (err) {
          logError(
            `Failed to connect to ${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Don't throw — other servers can still work
        }
      }),
    );

    const connected = [...this.upstreams.keys()];
    log(
      `Connected to ${connected.length}/${entries.length} servers: ${connected.join(", ")}`,
    );
  }

  private getFilteredTools(
    serverName: string,
    client: UpstreamClient,
  ): ToolInfo[] {
    const config = this.serverConfigs.get(serverName);
    const toolFilter: ToolFilterConfig | undefined = config?.tools;
    return filterTools(client.getTools(), toolFilter);
  }

  getAllTools(): NamespacedTool[] {
    const tools: NamespacedTool[] = [];

    for (const [serverName, client] of this.upstreams) {
      // Skip servers hidden by toolset manager (lazy loading)
      if (
        this._toolsetManager
        && !this._toolsetManager.isServerVisible(serverName)
      ) {
        continue;
      }

      const filteredTools = this.getFilteredTools(serverName, client);

      for (const tool of filteredTools) {
        const namespacedName = this.noPrefix
          ? tool.name
          : namespaceTool(serverName, tool.name, this.separator);

        tools.push({
          namespacedName,
          originalName: tool.name,
          serverName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    // Add meta-tools from toolset manager
    if (this._toolsetManager) {
      for (const metaTool of this._toolsetManager.getMetaTools()) {
        tools.push({
          namespacedName: metaTool.name,
          originalName: metaTool.name,
          serverName: "spike",
          description: metaTool.description,
          inputSchema: metaTool.inputSchema,
        });
      }
    }

    return tools;
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    // Handle meta-tools from toolset manager
    if (this._toolsetManager?.isMetaTool(namespacedName)) {
      return this._toolsetManager.handleMetaTool(namespacedName, args);
    }

    if (this.noPrefix) {
      // Without namespacing, try to find the tool across all upstreams
      for (const [serverName, client] of this.upstreams) {
        if (
          this._toolsetManager
          && !this._toolsetManager.isServerVisible(serverName)
        ) {
          continue;
        }
        const filteredTools = this.getFilteredTools(serverName, client);
        const hasTool = filteredTools.some(t => t.name === namespacedName);
        if (hasTool) {
          return client.callTool(namespacedName, args);
        }
      }
      throw new Error(`Tool not found: ${namespacedName}`);
    }

    const parsed = parseNamespacedTool(
      namespacedName,
      [...this.upstreams.keys()],
      this.separator,
    );

    if (!parsed) {
      throw new Error(`Cannot resolve tool: ${namespacedName}`);
    }

    const client = this.upstreams.get(parsed.serverName);
    if (!client) {
      throw new Error(`Server not connected: ${parsed.serverName}`);
    }

    // Check toolset visibility
    if (
      this._toolsetManager
      && !this._toolsetManager.isServerVisible(parsed.serverName)
    ) {
      throw new Error(`Tool not found: ${namespacedName} (toolset not loaded)`);
    }

    // Check that this tool is not filtered out
    const filteredTools = this.getFilteredTools(parsed.serverName, client);
    if (!filteredTools.some(t => t.name === parsed.toolName)) {
      throw new Error(`Tool not found: ${namespacedName}`);
    }

    return client.callTool(parsed.toolName, args);
  }

  getServerNames(): string[] {
    return [...this.upstreams.keys()];
  }

  getServerTools(serverName: string): ToolInfo[] {
    const client = this.upstreams.get(serverName);
    if (!client) return [];
    return this.getFilteredTools(serverName, client);
  }

  isConnected(serverName: string): boolean {
    const client = this.upstreams.get(serverName);
    return client?.connected ?? false;
  }

  async reconnect(serverName: string, config: ServerConfig): Promise<void> {
    const existing = this.upstreams.get(serverName);
    if (existing) {
      await existing.close();
      this.upstreams.delete(serverName);
    }

    const client = new UpstreamClient(serverName, config);
    await client.connect();
    this.upstreams.set(serverName, client);
    this.serverConfigs.set(serverName, config);
  }

  async closeAll(): Promise<void> {
    log("Shutting down all upstream connections...");
    await Promise.allSettled(
      [...this.upstreams.values()].map(client => client.close()),
    );
    this.upstreams.clear();
    this.serverConfigs.clear();
  }

  async disconnectServer(serverName: string): Promise<void> {
    const client = this.upstreams.get(serverName);
    if (client) {
      await client.close();
      this.upstreams.delete(serverName);
      this.serverConfigs.delete(serverName);
      log(`Disconnected server: ${serverName}`);
    }
  }

  /**
   * Apply a config diff: add new servers, remove deleted ones, reconnect changed ones.
   * Returns a summary of what changed.
   */
  async applyConfigDiff(
    oldConfig: ResolvedConfig,
    newConfig: ResolvedConfig,
  ): Promise<{ added: string[]; removed: string[]; changed: string[]; }> {
    const oldNames = new Set(Object.keys(oldConfig.servers));
    const newNames = new Set(Object.keys(newConfig.servers));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Remove servers no longer in config
    for (const name of oldNames) {
      if (!newNames.has(name)) {
        await this.disconnectServer(name);
        removed.push(name);
      }
    }

    // Add new servers
    for (const name of newNames) {
      if (!oldNames.has(name)) {
        try {
          const serverConfig = newConfig.servers[name];
          if (!serverConfig) continue; // Should not happen given newNames comes from keys
          const client = new UpstreamClient(name, serverConfig);
          await client.connect();
          this.upstreams.set(name, client);
          this.serverConfigs.set(name, serverConfig);
          added.push(name);
        } catch (err) {
          logError(
            `Failed to connect new server ${name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    // Reconnect changed servers (config differs)
    for (const name of newNames) {
      if (oldNames.has(name)) {
        const oldJson = JSON.stringify(oldConfig.servers[name]);
        const newJson = JSON.stringify(newConfig.servers[name]);
        if (oldJson !== newJson) {
          try {
            const serverConfig = newConfig.servers[name];
            if (!serverConfig) continue; // Should not happen
            await this.reconnect(name, serverConfig);
            changed.push(name);
          } catch (err) {
            logError(
              `Failed to reconnect ${name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    if (added.length || removed.length || changed.length) {
      log(
        `Config diff applied: +${added.length} -${removed.length} ~${changed.length}`,
      );
    }

    return { added, removed, changed };
  }
}
