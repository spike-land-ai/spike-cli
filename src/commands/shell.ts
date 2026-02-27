/**
 * `spike shell` command — interactive REPL for exploring MCP tools.
 */

import path from "node:path";
import type { Command } from "commander";
import { discoverConfig } from "../config/discovery";
import { ServerManager } from "../multiplexer/server-manager";
import { ToolsetManager } from "../multiplexer/toolset-manager";
import { startRepl } from "../shell/repl";
import { error as logError, log } from "../util/logger";

/** Known store-app slugs that have standalone MCP servers. */
const STORE_APP_SLUGS = new Set([
  "ai-orchestrator",
  "audio-studio",
  "be-uniq",
  "boycott-vmo2",
  "brand-command",
  "career-navigator",
  "chess-arena",
  "cleansweep",
  "code-review-agent",
  "codespace",
  "content-hub",
  "mcp-explorer",
  "page-builder",
  "qa-studio",
  "social-autopilot",
  "state-machine",
  "tabletop-sim",
]);

export function registerShellCommand(program: Command): void {
  program
    .command("shell")
    .description("Interactive REPL to explore and call MCP tools")
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
    .option("--app <slug>", "Load a store app by slug (e.g. chess-arena)")
    .option("--namespace-separator <str>", "Tool name separator", "__")
    .option("--no-prefix", "Don't namespace tool names")
    .action(async options => {
      try {
        // Resolve --app shorthand into an inline stdio server
        const appServers = resolveAppServers(options.app);

        const config = await discoverConfig({
          configPath: options.config,
          inlineServers: [
            ...parseInlineServers(options.server),
            ...appServers,
          ],
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

        await startRepl(manager, config);
      } catch (err) {
        logError(
          `shell failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseInlineServers(
  items: string[],
): Array<{ name: string; command: string; }> {
  return items.map(item => {
    const eq = item.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid --server format: "${item}". Use name=command`);
    }
    return { name: item.slice(0, eq), command: item.slice(eq + 1) };
  });
}

function parseInlineUrls(
  items: string[],
): Array<{ name: string; url: string; }> {
  return items.map(item => {
    const eq = item.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid --server-url format: "${item}". Use name=url`);
    }
    return { name: item.slice(0, eq), url: item.slice(eq + 1) };
  });
}

function resolveAppServers(
  appSlug?: string,
): Array<{ name: string; command: string; }> {
  if (!appSlug) return [];
  if (!STORE_APP_SLUGS.has(appSlug)) {
    const available = [...STORE_APP_SLUGS].sort().join(", ");
    throw new Error(
      `Unknown store app: "${appSlug}". Available: ${available}`,
    );
  }
  const entryPath = path.resolve(
    __dirname,
    "../../../store-apps",
    appSlug,
    "index.ts",
  );
  return [{ name: appSlug, command: `tsx ${entryPath}` }];
}
