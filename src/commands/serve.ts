/**
 * `spike serve` command — starts the MCP multiplexer server.
 * Supports stdio (default), http, and sse transports.
 */

import type { Command } from "commander";
import { discoverConfig } from "../config/discovery";
import { ServerManager } from "../multiplexer/server-manager";
import { ToolsetManager } from "../multiplexer/toolset-manager";
import { MultiplexerServer } from "../multiplexer/multiplexer-server";
import { error as logError, log } from "../util/logger";
import { collect, parseInlineServers, parseInlineUrls } from "./common";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start MCP multiplexer server")
    .option("--config <path>", "Path to .mcp.json config file")
    .option(
      "--server <name=command>",
      "Add stdio server inline (repeatable)",
      collect,
      [],
    )
    .option(
      "--server-url <name=url>",
      "Add HTTP/SSE server inline (repeatable)",
      collect,
      [],
    )
    .option("--namespace-separator <str>", "Tool name separator", "__")
    .option("--no-prefix", "Don't namespace tool names")
    .option("--transport <type>", "Transport: stdio | http | sse", "stdio")
    .option("--port <port>", "Port for HTTP/SSE transport", "3050")
    .option("--api-key <key>", "API key for HTTP transport auth")
    .option("--base-url <url>", "Base URL for spike.land", "https://spike.land")
    .action(async options => {
      try {
        const config = await discoverConfig({
          configPath: options.config,
          inlineServers: parseInlineServers(options.server),
          inlineUrls: parseInlineUrls(options.serverUrl),
        });

        if (Object.keys(config.servers).length === 0) {
          logError(
            "No MCP servers configured. Use --config, --server, or create .mcp.json",
          );
          process.exit(1);
        }

        const manager = new ServerManager({
          separator: options.namespaceSeparator,
          noPrefix: !options.prefix,
        });

        await manager.connectAll(config);

        // Set up lazy loading if configured
        if (
          config.lazyLoading && config.toolsets
          && Object.keys(config.toolsets).length > 0
        ) {
          const toolsetManager = new ToolsetManager(
            config.toolsets,
            (serverName: string) => manager.getServerTools(serverName).length,
          );
          manager.setToolsetManager(toolsetManager);
          log(
            `Lazy loading enabled with ${Object.keys(config.toolsets).length} toolsets`,
          );
        }

        const transport = options.transport as string;
        const port = parseInt(options.port as string, 10);

        if (transport === "http" || transport === "sse") {
          const { startHttpServer } = await import(
            "../transport/http-server.js"
          );
          const { startSseServer } = await import("../transport/sse-server.js");

          const startFn = transport === "http"
            ? startHttpServer
            : startSseServer;
          const server = await startFn(manager, {
            port,
            apiKey: options.apiKey,
          });

          // Graceful shutdown
          const shutdown = async () => {
            log("Shutting down...");
            await server.close();
            await manager.closeAll();
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        } else {
          // Default: stdio transport
          const mux = new MultiplexerServer(manager);

          const shutdown = async () => {
            log("Shutting down...");
            await mux.close();
            await manager.closeAll();
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);

          await mux.serve();
        }
      } catch (err) {
        logError(
          `serve failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
