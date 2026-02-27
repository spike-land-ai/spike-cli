/**
 * Manages on-demand toolset loading for lazy tool loading feature.
 * When lazyLoading is enabled, servers grouped into toolsets have their
 * tools hidden until explicitly loaded via spike__load_toolset.
 */

import type { ToolsetConfig } from "../config/types";
import type { ToolInfo } from "./types";
import { log } from "../util/logger";

export interface ToolsetInfo {
  name: string;
  description?: string;
  loaded: boolean;
  servers: string[];
  toolCount: number;
}

export class ToolsetManager {
  private toolsets: Record<string, ToolsetConfig>;
  private loadedToolsets = new Set<string>();
  private serverToolCountFn: (serverName: string) => number;

  constructor(
    toolsets: Record<string, ToolsetConfig>,
    serverToolCountFn: (serverName: string) => number,
  ) {
    this.toolsets = toolsets;
    this.serverToolCountFn = serverToolCountFn;
  }

  /**
   * Check if a server's tools should be visible.
   * A server is visible if:
   * - It's not part of any toolset (always visible)
   * - It's part of a loaded toolset
   */
  isServerVisible(serverName: string): boolean {
    // Check if this server belongs to any toolset
    const belongsToToolset = Object.values(this.toolsets).some(ts =>
      ts.servers.includes(serverName)
    );

    if (!belongsToToolset) {
      return true; // Not in any toolset = always visible
    }

    // Check if any toolset containing this server is loaded
    for (const [name, ts] of Object.entries(this.toolsets)) {
      if (ts.servers.includes(serverName) && this.loadedToolsets.has(name)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Load a toolset, making its servers' tools visible.
   */
  loadToolset(name: string): { loaded: string[]; toolCount: number; } {
    const toolset = this.toolsets[name];
    if (!toolset) {
      throw new Error(`Unknown toolset: ${name}`);
    }

    this.loadedToolsets.add(name);
    log(`Loaded toolset: ${name} (servers: ${toolset.servers.join(", ")})`);

    const toolCount = toolset.servers.reduce(
      (sum, server) => sum + this.serverToolCountFn(server),
      0,
    );

    return { loaded: toolset.servers, toolCount };
  }

  /**
   * Unload a toolset, hiding its servers' tools.
   */
  unloadToolset(name: string): void {
    if (!this.toolsets[name]) {
      throw new Error(`Unknown toolset: ${name}`);
    }
    this.loadedToolsets.delete(name);
    log(`Unloaded toolset: ${name}`);
  }

  /**
   * List available toolsets with metadata.
   */
  listToolsets(): ToolsetInfo[] {
    return Object.entries(this.toolsets).map(([name, ts]) => ({
      name,
      description: ts.description,
      loaded: this.loadedToolsets.has(name),
      servers: ts.servers,
      toolCount: ts.servers.reduce(
        (sum, server) => sum + this.serverToolCountFn(server),
        0,
      ),
    }));
  }

  /**
   * Generate meta-tool definitions for spike__list_toolsets and spike__load_toolset.
   */
  getMetaTools(): ToolInfo[] {
    return [
      {
        name: "spike__list_toolsets",
        description: "List available toolsets and their status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "spike__load_toolset",
        description: "Load a toolset to make its tools available",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the toolset to load",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "spike__unload_toolset",
        description:
          "Unload a previously loaded toolset, removing its tools from the active context to save context window space",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the toolset to unload",
            },
          },
          required: ["name"],
        },
      },
    ];
  }

  isMetaTool(toolName: string): boolean {
    return toolName === "spike__list_toolsets"
      || toolName === "spike__load_toolset"
      || toolName === "spike__unload_toolset";
  }

  handleMetaTool(
    toolName: string,
    args: Record<string, unknown>,
  ): { content: Array<{ type: string; text: string; }>; isError?: boolean; } {
    if (toolName === "spike__list_toolsets") {
      const toolsets = this.listToolsets();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(toolsets, null, 2),
          },
        ],
      };
    }

    if (toolName === "spike__load_toolset") {
      const name = typeof args.name === "string" ? args.name : "";
      if (!name) {
        return {
          content: [{ type: "text", text: "Error: name is required" }],
          isError: true,
        };
      }
      try {
        const result = this.loadToolset(name);
        return {
          content: [
            {
              type: "text",
              text: `Loaded toolset "${name}": ${
                result.loaded.join(", ")
              } (${result.toolCount} tools now available)`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (toolName === "spike__unload_toolset") {
      const name = typeof args.name === "string" ? args.name : "";
      if (!name) {
        return {
          content: [{ type: "text", text: "Error: name is required" }],
          isError: true,
        };
      }
      if (!this.toolsets[name]) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Unknown toolset: ${name}`,
            },
          ],
          isError: true,
        };
      }
      if (!this.loadedToolsets.has(name)) {
        return {
          content: [
            {
              type: "text",
              text: `Toolset "${name}" is not currently loaded`,
            },
          ],
          isError: true,
        };
      }
      const servers = this.toolsets[name].servers;
      this.unloadToolset(name);
      return {
        content: [
          {
            type: "text",
            text: `Unloaded toolset "${name}": servers ${servers.join(", ")} are now hidden`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown meta-tool: ${toolName}` }],
      isError: true,
    };
  }
}
