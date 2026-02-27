/**
 * Tool name namespacing — prefix tool names with server name.
 * E.g., "vitest" + "run_tests" → "vitest__run_tests"
 */

export const DEFAULT_SEPARATOR = "__";

export function namespaceTool(
  serverName: string,
  toolName: string,
  separator: string = DEFAULT_SEPARATOR,
): string {
  return `${serverName}${separator}${toolName}`;
}

export interface ParsedTool {
  serverName: string;
  toolName: string;
}

/**
 * Parse a namespaced tool name back into server + tool.
 * Uses greedy matching: longest known server name prefix wins.
 */
export function parseNamespacedTool(
  namespacedName: string,
  knownServers: string[],
  separator: string = DEFAULT_SEPARATOR,
): ParsedTool | null {
  // Sort by length descending for greedy match
  const sorted = [...knownServers].sort((a, b) => b.length - a.length);

  for (const server of sorted) {
    const prefix = `${server}${separator}`;
    if (namespacedName.startsWith(prefix)) {
      return {
        serverName: server,
        toolName: namespacedName.slice(prefix.length),
      };
    }
  }

  return null;
}

/**
 * Strip namespace prefix from a tool name if present.
 */
export function stripNamespace(
  namespacedName: string,
  serverName: string,
  separator: string = DEFAULT_SEPARATOR,
): string {
  const prefix = `${serverName}${separator}`;
  if (namespacedName.startsWith(prefix)) {
    return namespacedName.slice(prefix.length);
  }
  return namespacedName;
}
