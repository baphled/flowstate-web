import { markRaw, type Component } from "vue";

const toolComponents = new Map<string, Component>();

export const CONTEXT_TOOLS = Object.freeze([
  "read",
  "glob",
  "grep",
  "list",
] as const);

export function registerTool({
  name,
  component,
}: {
  name: string;
  component: Component;
}): void {
  toolComponents.set(name, markRaw(component));
}

export function getToolComponent(name: string): Component | undefined {
  return toolComponents.get(name) ?? toolComponents.get(toolNameBasename(name));
}

/**
 * toolNameBasename strips MCP-style namespace prefixes so a namespaced
 * emission (`mcp__server__question`, `plugin:question`) resolves to the
 * same renderer as its bare basename (`question`). Backends may publish
 * namespaced tool names while the FE registers the bare name; matching
 * on the suffix keeps both shapes on one render path.
 */
export function toolNameBasename(name: string): string {
  const separators = ["::", "__", ":", "/"];
  let basename = name;
  for (const sep of separators) {
    const idx = basename.lastIndexOf(sep);
    if (idx !== -1 && idx + sep.length < basename.length) {
      basename = basename.slice(idx + sep.length);
    }
  }
  return basename;
}

/**
 * toolNamesMatch reports whether a wire-side tool_name (e.g. from a
 * pending question/permission request) anchors to a message-side
 * toolName. Exact match wins; otherwise both sides normalise through
 * toolNameBasename so `mcp__fs__question` matches `question`.
 */
export function toolNamesMatch(wireName: string, messageName: string): boolean {
  if (wireName === messageName) return true;
  return toolNameBasename(wireName) === toolNameBasename(messageName);
}

export function isContextTool(name: string): boolean {
  return CONTEXT_TOOLS.includes(name as (typeof CONTEXT_TOOLS)[number]);
}
