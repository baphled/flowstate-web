/**
 * Map a file path to a Shiki grammar name for tool outputs (ReadTool /
 * WriteTool). Only languages the existing highlighter bundles are
 * returned — anything else resolves to undefined so callers can keep
 * their plain render path.
 */
const EXTENSION_LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  py: "python",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  ps1: "powershell",
  zig: "zig",
};

/** Resolve the trailing extension of `filePath` to a supported grammar
 *  name, or undefined when the path has no extension / the extension is
 *  not in the bundled set. */
export function resolveFileLang(filePath: string): string | undefined {
  const match = /\.([A-Za-z0-9_-]+)$/.exec(filePath.trim());
  if (match === null) return undefined;
  return EXTENSION_LANGS[match[1].toLowerCase()];
}
