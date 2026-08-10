import type { Message } from "@/types";

export interface ToolRenderSpec {
  toolName: string;
  heading: string;
  body: string;
}

const primaryArgKeys: Record<string, string> = {
  bash: "command",
  read: "filePath",
  write: "filePath",
  edit: "filePath",
  multiedit: "filePath",
  apply_patch: "filePath",
  glob: "pattern",
  grep: "pattern",
  skill_load: "name",
};

// preferredFallbackKeys mirrors the Go-side priority list in
// internal/tool/display/display.go. The first key whose value is a non-empty
// string wins. This is what restores tool-input display for tools outside the
// hand-coded allowlist (delegate, search_nodes, coordination_store, MCP tools,
// etc.) so the chat UI shows what the tool was called with rather than a bare
// tool name.
const preferredFallbackKeys = [
  "query",
  "subagent_type",
  "name",
  "key",
  "path",
  "id",
  "url",
  "title",
  "operation",
];

const sensitiveKeySubstrings = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "auth",
  "credential",
];

const redactedPlaceholder = "[REDACTED]";

// truncateLen caps the compact-JSON fallback blob only. Tool titles show
// the full command/path for every tool; only the compact-JSON fallback
// blob keeps a cap so MCP tools with huge JSON blobs cannot blow up the
// card.
const truncateLen = 80;

function truncate(s: string): string {
  if (s.length <= truncateLen) {
    return s;
  }
  return s.slice(0, truncateLen) + "...";
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return sensitiveKeySubstrings.some((sub) => lower.includes(sub));
}

function redactIfSensitive(key: string, value: string): string {
  return isSensitiveKey(key) ? redactedPlaceholder : value;
}

function parseToolInput(
  raw: string | undefined,
): Record<string, unknown> | string | null {
  // Returns one of:
  //   - parsed object: SSE payload (full args JSON from server.go)
  //   - raw string: persisted bare-string ToolInput from older sessions
  //     before the backend switched to the tiered fallback
  //   - null: nothing usable
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // JSON parsed to a non-object (e.g. a bare quoted string). Fall through
    // to raw-string handling.
    if (typeof parsed === "string") {
      return parsed;
    }
    return null;
  } catch {
    // raw is not JSON — treat as a bare display string (the backend's
    // persisted format for hand-coded tools historically).
    return raw;
  }
}

function compactJSONFallback(args: Record<string, unknown>): string | null {
  const keys = Object.keys(args).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = args[key];
    if (typeof v !== "string" || v === "") {
      continue;
    }
    const safe = redactIfSensitive(key, v);
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(safe)}`);
  }
  if (parts.length === 0) {
    return null;
  }
  const rendered = `{${parts.join(",")}}`;
  const capped = truncate(rendered);
  return capped === "" ? null : capped;
}

function resolvePrimaryValue(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const primary = primaryArgKeys[toolName];
  if (primary) {
    const raw = args[primary];
    if (typeof raw === "string" && raw !== "") {
      return redactIfSensitive(primary, raw);
    }
  }

  for (const key of preferredFallbackKeys) {
    const v = args[key];
    if (typeof v === "string" && v !== "") {
      return redactIfSensitive(key, v);
    }
  }

  return compactJSONFallback(args);
}

/**
 * Tool titles show the full command/path for every tool; only the
 * compact-JSON fallback blob keeps a cap (see compactJSONFallback).
 */
function formatHeadingValue(
  _toolName: string,
  rawValue: string,
): string {
  return rawValue;
}

function resolveHeading(
  toolName: string,
  parsed: Record<string, unknown> | string | null,
): string {
  if (parsed === null) {
    return toolName;
  }
  if (typeof parsed === "string") {
    // Backend persisted a bare-string ToolInput (e.g. older sessions, or the
    // hand-coded path before the unification). Render it directly.
    return `${toolName} ${formatHeadingValue(toolName, parsed)}`;
  }

  const value = resolvePrimaryValue(toolName, parsed);
  if (value === null || value === "") {
    return toolName;
  }
  return `${toolName} ${formatHeadingValue(toolName, value)}`;
}

/**
 * Formats the heading for a skill_load message. Handles both parsed-object
 * input ({"name":"<skill>"}) and bare-string persisted input ("<skill>").
 */
function skillLoadHeading(parsed: Record<string, unknown> | string | null): string {
  let skillName = "";
  if (parsed && typeof parsed === "object") {
    const v = (parsed as Record<string, unknown>).name;
    skillName = typeof v === "string" ? v : "";
  } else if (typeof parsed === "string") {
    skillName = parsed;
  }
  return `→Skill "${skillName}"`;
}

/**
 * Build the canonical render spec for a tool message, mirroring the tiered
 * fallback in internal/tool/display/display.go. Returns empty fields for
 * non-tool messages so callers can render a uniform shape.
 */
export function buildToolRenderSpec(message: Message): ToolRenderSpec {
  const toolName = message.toolName ?? "";
  if (!toolName) {
    return { toolName: "", heading: "", body: "" };
  }

  const parsed = parseToolInput(message.toolInput);
  const heading = resolveHeading(toolName, parsed);
  const body = message.role === "tool_result" ? (message.content ?? "") : "";

  // Special-case skill_load: render as "→Skill \"<name>\"" for both
  // parsed-object and bare-string persisted input. Body is hidden —
  // SkillLoadTool renders an inline label with no output section.
  if (toolName === "skill_load") {
    return { toolName, heading: skillLoadHeading(parsed), body: "" };
  }

  return { toolName, heading, body };
}
