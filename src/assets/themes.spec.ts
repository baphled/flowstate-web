/**
 * themes.spec.ts — contract spec for the FlowState theme design system.
 *
 * Guards the `--surface-low` custom property used by every code-block /
 * tool surface (HighlightedCode, BashTool, EditTool, WriteTool, ReadTool,
 * ToolErrorCard, ToolBubble, GrepTool, GlobTool, RecallSearchTool). Those
 * components reference `var(--surface-low, #1a1b26)`; if a theme block
 * ever drops the declaration, the surfaces silently fall back to the
 * hardcoded dark navy in every theme — including light mode.
 *
 * Assertions are whitespace-robust by design: they check declaration
 * presence (`--surface-low` followed by `:`), never exact hex values.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "@/types";

// Mirrors settingsStore.ts VALID_THEMES — the exact set of keys the
// store accepts as `data-theme` values.
const VALID_THEMES: readonly Theme[] = [
  "dark",
  "light",
  "terminal",
  "tokyo-night",
  "catppuccin-mocha",
  "dracula",
  "nord",
];

// Resolve relative to this spec file (same pattern as
// ToastContainer.layout.spec.ts) so the path is deterministic across
// vitest pool configurations.
const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, "themes.css");
const cssSource = readFileSync(cssPath, "utf8");

/** Theme blocks are `[data-theme="<key>"] { ... }` flat declaration
 *  blocks. Matching `] {` (not `] .shiki,`) excludes the Shiki binding
 *  selectors at the bottom of themes.css, which also contain
 *  `[data-theme="<key>"]` but are not theme blocks. */
function themeBlocks(): Array<[string, string]> {
  const blocks: Array<[string, string]> = [];
  for (const match of cssSource.matchAll(/\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)) {
    blocks.push([match[1], match[2]]);
  }
  return blocks;
}

describe("themes.css — every VALID_THEMES key ships a --surface-low surface token", () => {
  it("defines a [data-theme=\"<key>\"] block with --surface-low for every theme", () => {
    for (const theme of VALID_THEMES) {
      const block = themeBlocks().find(([key]) => key === theme);
      expect(block, `missing [data-theme="${theme}"] block`).toBeDefined();
      expect(
        block?.[1],
        `[data-theme="${theme}"] block lacks --surface-low`,
      ).toMatch(/--surface-low\s*:/);
    }
  });

  it("defines --surface-low in the :root default block (shares the dark theme)", () => {
    const rootSelector = cssSource.indexOf(":root,");
    expect(rootSelector).not.toBe(-1);
    const openBrace = cssSource.indexOf("{", rootSelector);
    const closeBrace = cssSource.indexOf("}", openBrace);
    const rootBlock = cssSource.slice(openBrace + 1, closeBrace);
    expect(rootBlock).toMatch(/--surface-low\s*:/);
  });

  it("has no theme block missing --surface-low", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(VALID_THEMES.length);
    for (const [theme, body] of blocks) {
      expect(body, `[data-theme="${theme}"] block is missing --surface-low`).toMatch(
        /--surface-low\s*:/,
      );
    }
  });
});
