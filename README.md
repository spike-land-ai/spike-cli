# @spike-npm-land/spike-mcp-cli

The primary CLI for the spike.land platform. Aggregates multiple MCP servers
into a single multiplexed endpoint, with built-in authentication, a server
registry, and an interactive chat interface powered by Claude.

## Why Lazy Toolset Loading Matters

AI agents work best with small, relevant tool lists. When an LLM receives
hundreds of tool definitions at once, it spends context window space parsing
tools it will never use — leading to worse decisions and higher cost.

spike-cli solves this with **lazy toolset loading**: tools are grouped into
named toolsets that load on demand. By default, only a handful of gateway tools
are visible. When the agent needs chess tools or testing tools, it loads that
toolset — and only that toolset enters the context window.

**Three benefits:**

1. **Context savings** — hundreds of tools available, but only the active
   toolset is visible
2. **Better AI decisions** — a small relevant list beats a giant
   undifferentiated one
3. **One config** — any mix of stdio/SSE/HTTP servers, namespaced automatically

## Installation

```bash
npm install -g @spike-npm-land/spike-mcp-cli
```

Or run directly from the monorepo:

```bash
cd packages/spike-cli
yarn dev
```

## Commands

### `spike serve`

Start the MCP multiplexer server. Connects to all configured MCP servers and
exposes their tools through a single endpoint with lazy toolset loading.

```bash
spike serve                          # stdio transport (default)
spike serve --transport sse --port 3050  # SSE transport
spike serve --config ./my-config.json    # custom config
spike serve --server myserver="node server.js"  # inline server
```

**Options:**

- `--config <path>` — Path to `.mcp.json` config file
- `--server <name=command>` — Add a stdio server inline (repeatable)
- `--server-url <name=url>` — Add an HTTP/SSE server inline (repeatable)
- `--transport <type>` — Transport: `stdio` | `http` | `sse` (default: `stdio`)
- `--port <port>` — Port for HTTP/SSE transport (default: `3050`)
- `--namespace-separator <str>` — Tool name separator (default: `__`)
- `--no-prefix` — Don't namespace tool names

### `spike chat`

Interactive Claude chat session with all configured MCP tools available.

```bash
spike chat                           # default model (claude-sonnet-4-6)
spike chat --model claude-opus-4-6   # specify model
spike chat --system "You are a deployment assistant"
```

**Options:**

- `--model <model>` — Claude model to use (default: `claude-sonnet-4-6`)
- `--system <prompt>` — System prompt
- `--max-turns <n>` — Maximum agentic turns per message (default: `20`)

Requires `CLAUDE_CODE_OAUTH_TOKEN` environment variable.

### `spike shell`

Interactive REPL for exploring and calling MCP tools directly.

```bash
spike shell
spike shell --config ./my-config.json
```

### `spike auth`

Manage authentication with spike.land.

```bash
spike auth login       # Log in with device code flow
spike auth logout      # Remove stored credentials
spike auth status      # Check current auth status
```

### `spike registry`

Browse and install MCP servers from the spike.land registry.

```bash
spike registry search <query>   # Search for MCP servers
spike registry add <id>         # Add a server to your config
```

### `spike alias`

Manage command aliases for frequently used operations.

```bash
spike alias set <name> <command>   # Create an alias
spike alias remove <name>          # Remove an alias
spike alias list                   # List all aliases
```

### `spike completions`

Install or remove shell tab completions.

```bash
spike completions install     # Install for your shell (bash/zsh/fish)
spike completions uninstall   # Remove completions
```

### `spike status`

Health check for all configured MCP servers. Reports connection status, tool
counts, latency, and environment variable availability.

```bash
spike status
spike status --config ./my-config.json
```

## Configuration

spike-cli discovers configuration from `.mcp.json` files. It searches:

1. Explicit `--config` path
2. `.mcp.json` in the current directory
3. `~/.mcp.json` in the home directory

Example `.mcp.json`:

```json
{
  "servers": {
    "my-tools": {
      "command": "node",
      "args": ["./my-mcp-server.js"]
    },
    "remote-server": {
      "url": "https://example.com/mcp"
    }
  }
}
```

## Global Options

- `--verbose` — Verbose logging to stderr
- `--base-url <url>` — Base URL for spike.land (default: `https://spike.land`)
- `--help` — Show help
- `--version` — Show version

## Development

```bash
cd packages/spike-cli

yarn dev          # Run CLI in dev mode (tsx)
yarn build        # Build with tsup
yarn test         # Run tests
yarn typecheck    # Type check
```

## License

BSD-3-Clause
