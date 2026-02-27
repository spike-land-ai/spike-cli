/**
 * Interactive chat REPL for `spike chat`.
 */

import { createInterface } from "node:readline";
import type { ChatClient, Message } from "./client";
import type { ServerManager } from "../multiplexer/server-manager";
import { runAgentLoop } from "./loop";
import { bold, dim, yellow } from "../shell/formatter";
import {
  handleSlashCommand,
  SessionState,
  trackToolCallForSession,
} from "./slash-commands";
import { AppRegistryImpl } from "./app-registry";

export interface ChatReplOptions {
  client: ChatClient;
  manager: ServerManager;
  maxTurns?: number;
}

export async function startChatRepl(options: ChatReplOptions): Promise<void> {
  const { client, manager, maxTurns } = options;
  const messages: Message[] = [];
  const sessionState = new SessionState();

  // Initialize app registry with bundled data
  const appRegistry = new AppRegistryImpl();

  // Attempt to refresh from remote (non-blocking)
  appRegistry.refreshFromRemote(manager).catch(() => {
    // Silently fall back to bundled data
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: `${bold("you")}${dim(">")} `,
    terminal: true,
  });

  const toolCount = manager.getAllTools().length;
  const serverCount = manager.getServerNames().length;
  console.error(
    `${bold("spike chat")} — ${client.model} with ${toolCount} tools from ${serverCount} servers`,
  );
  console.error(`Type ${dim("/help")} for commands, ${dim("/quit")} to exit\n`);
  rl.prompt();

  rl.on("line", async line => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands (both built-in and direct tool invocation)
    if (trimmed.startsWith("/")) {
      try {
        const result = await handleSlashCommand(trimmed, {
          manager,
          client,
          messages,
          sessionState,
          appRegistry,
          rl,
        });

        if (result.exit) {
          console.error("\nGoodbye.");
          await manager.closeAll();
          process.exit(0);
        }

        if (result.cleared) {
          messages.length = 0;
        }

        if (result.output) console.error(result.output);
        console.error("");
      } catch (err) {
        console.error(
          `${yellow("Error:")} ${err instanceof Error ? err.message : String(err)}`,
        );
        console.error("");
      }
      rl.prompt();
      return;
    }

    // Run agentic loop
    try {
      console.error("");
      // Map tool_use IDs to tool names for session state tracking
      const toolUseIdToName = new Map<string, string>();
      await runAgentLoop(trimmed, {
        client,
        manager,
        messages,
        maxTurns,
        onTextDelta: text => process.stderr.write(text),
        onToolCall: name => console.error(`\n${dim(`[calling ${name}...]`)}`),
        onToolCallStart: (id, name) => {
          toolUseIdToName.set(id, name);
        },
        onToolCallEnd: (id, result, isError) => {
          const toolName = toolUseIdToName.get(id) ?? id;
          trackToolCallForSession(
            toolName,
            result,
            isError,
            manager.getAllTools(),
            sessionState,
          );
        },
      });
      console.error("\n");
    } catch (err) {
      console.error(
        `\n${yellow("Error:")} ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.error("\nGoodbye.");
    await manager.closeAll();
    process.exit(0);
  });
}
