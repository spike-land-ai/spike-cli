/**
 * `spike chat` command — interactive Claude chat with MCP tools.
 */

import type { Command } from "commander";
import { discoverConfig } from "../config/discovery";
import { ServerManager } from "../multiplexer/server-manager";
import { ToolsetManager } from "../multiplexer/toolset-manager";
import { ChatClient } from "../chat/client";
import { startChatRepl } from "../chat/repl";
import { error as logError, log } from "../util/logger";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive Claude chat with all MCP tools available")
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
    .option("--model <model>", "Claude model to use", "claude-sonnet-4-6")
    .option("--system <prompt>", "System prompt")
    .option(
      "--max-turns <n>",
      "Maximum agentic turns per message",
      parseIntArg,
      20,
    )
    .action(async options => {
      try {
        const authToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        if (!authToken) {
          logError(
            "CLAUDE_CODE_OAUTH_TOKEN not set. Export it to use spike chat.\n"
              + "  export CLAUDE_CODE_OAUTH_TOKEN=your-token",
          );
          process.exit(1);
        }

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

        const client = new ChatClient({
          authToken,
          model: options.model,
          systemPrompt: options.system,
        });

        await startChatRepl({ client, manager, maxTurns: options.maxTurns });
      } catch (err) {
        logError(
          `chat failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseIntArg(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
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
