/**
 * readline-based REPL loop for `spike shell`.
 */

import { createInterface } from "node:readline";
import type { ServerManager } from "../multiplexer/server-manager";
import type { ResolvedConfig } from "../config/types";
import {
  handleAlias,
  handleCall,
  handleHelp,
  handleLoadToolset,
  handleReconnect,
  handleServers,
  handleTools,
  handleToolsets,
  type ShellContext,
} from "./commands";
import { loadAliases } from "../alias/store";
import { AliasResolver } from "../alias/resolver";
import { bold, dim } from "./formatter";
import { createCompleter } from "./completer";

export async function startRepl(
  manager: ServerManager,
  config: ResolvedConfig,
): Promise<void> {
  const aliases = await loadAliases();
  const resolver = new AliasResolver(
    aliases,
    new Set(manager.getAllTools().map(t => t.namespacedName)),
  );
  const ctx: ShellContext = { manager, config, resolver };
  const completer = createCompleter(manager);

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr so stdout stays clean for piping
    prompt: `${bold("spike")}${dim(">")} `,
    terminal: true,
    completer,
  });

  console.error(
    bold("spike shell") + " — type " + dim("help") + " for commands\n",
  );
  console.error(handleServers(ctx));
  console.error("");

  rl.prompt();

  rl.on("line", async line => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const [firstWord, ...rest] = trimmed.split(/\s+/);
    let command = firstWord ?? "";
    let output = "";

    // Resolve command aliases
    const cmdResolved = resolver.resolveCommand(command);
    if (cmdResolved.type === "command") {
      command = cmdResolved.command;
    }

    switch (command) {
      case "servers":
        output = handleServers(ctx);
        break;

      case "tools":
        output = handleTools(ctx, rest[0]);
        break;

      case "call": {
        const toolName = rest[0]!;
        const jsonArgs = rest.slice(1).join(" ") || undefined;
        output = await handleCall(ctx, toolName, jsonArgs);
        break;
      }

      case "reconnect":
        output = await handleReconnect(ctx, rest[0]!);
        break;

      case "help":
        output = handleHelp();
        break;

      case "toolsets":
        output = handleToolsets(ctx);
        break;

      case "load":
        output = handleLoadToolset(ctx, rest[0]!);
        break;

      case "alias":
        output = await handleAlias(ctx, rest);
        break;

      case "quit":
      case "exit":
      case ".exit":
        console.error("\nGoodbye.");
        await manager.closeAll();
        process.exit(0);
        break;

      default:
        output = `Unknown command: ${command}. Type "help" for available commands.`;
    }

    if (output) {
      console.error(output);
    }
    console.error("");
    rl.prompt();
  });

  rl.on("close", async () => {
    console.error("\nGoodbye.");
    await manager.closeAll();
    process.exit(0);
  });
}
