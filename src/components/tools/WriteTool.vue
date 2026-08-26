<script setup lang="ts">
import { computed } from "vue";
import CopyButton from "./CopyButton.vue";
import HighlightedCode from "./HighlightedCode.vue";
import ToolBubble from "./ToolBubble.vue";
import { resolveFileLang } from "@/lib/fileLang";
import type { ToolRendererProps } from "./toolRendererProps";

const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "completed",
});

function parseToolInput(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// Candidate path arg keys, in priority order — mirrors the alias list in
// toolRenderSpec.ts primaryArgKeys so the summary line resolves the same
// path the subtitle shows. The backend write tool's schema uses `path`
// (internal/tool/write/write.go); the other aliases cover the variants
// other emitters have used.
const PATH_ARG_KEYS = ["filePath", "file_path", "file", "path"] as const;

// The path comes from toolInput when present ({"filePath": "...", "exists":
// false}); otherwise strip the leading "<toolName> " prefix off the heading.
function resolveFilePath(): string {
  const input = parseToolInput(props.toolInput);
  for (const key of PATH_ARG_KEYS) {
    const fromInput = input[key];
    if (typeof fromInput === "string" && fromInput !== "") {
      return fromInput;
    }
  }
  const prefix = `${props.toolName} `;
  return props.heading.startsWith(prefix)
    ? props.heading.slice(prefix.length)
    : props.heading;
}

const filePath = computed(() => resolveFilePath());

// The written contents. The structured args are authoritative when they
// carry a string `content`/`contents` key — the tool_result body is often
// a short confirmation ("ok" / a summary line) rather than the file
// itself. Otherwise fall back to the body (the backend-echo shape).
function resolveWrittenContent(): string {
  const input = parseToolInput(props.toolInput);
  for (const key of ["content", "contents"] as const) {
    if (key in input) {
      const value = input[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return props.body;
}

const writtenContent = computed(() => resolveWrittenContent());

const isNewFile = computed(() => {
  const input = parseToolInput(props.toolInput);
  return input.exists === false;
});

const bodyLines = computed<string[]>(() => {
  if (!writtenContent.value) return [];
  return writtenContent.value.split("\n");
});

const writeFileLang = computed<string | undefined>(() =>
  resolveFileLang(filePath.value),
);
</script>

<template>
  <ToolBubble
    :tool-name="props.toolName"
    :title="props.toolName"
    :subtitle="props.heading"
    :status="props.status"
    :default-open="true"
  >
    <div class="tool-renderer" data-component="write-tool">
      <div class="tool-renderer__header">
        <span class="tool-renderer__label">Written content</span>
        <CopyButton :text="writtenContent" />
      </div>
      <div class="tool-write-summary" data-testid="write-summary">
        <span class="tool-write-summary__added"
          >+{{ bodyLines.length }} lines written to {{ filePath }}</span
        >
        <span
          v-if="isNewFile"
          class="tool-write-summary__badge"
          data-testid="write-new-file-badge"
          >new file</span
        >
      </div>
      <div class="tool-write-content" data-component="write-content">
        <HighlightedCode
          :code="writtenContent"
          :lang="writeFileLang"
          max-height="none"
        />
      </div>
    </div>
  </ToolBubble>
</template>

<style scoped>
.tool-renderer {
  display: grid;
  gap: 0.45rem;
}

.tool-renderer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.tool-renderer__label {
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
}

.tool-write-summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 0.8rem;
  font-weight: 600;
}

.tool-write-summary__added {
  color: #9ece6a;
}

.tool-write-summary__badge {
  padding: 0.1rem 0.45rem;
  border: 1px solid rgba(158, 206, 106, 0.45);
  border-radius: 999px;
  color: #9ece6a;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
