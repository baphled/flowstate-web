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

// The path comes from toolInput when present ({"filePath": "...", "exists":
// false}); otherwise strip the leading "<toolName> " prefix off the heading.
function resolveFilePath(): string {
  const input = parseToolInput(props.toolInput);
  const fromInput = input.filePath ?? input.file_path;
  if (typeof fromInput === "string" && fromInput !== "") {
    return fromInput;
  }
  const prefix = `${props.toolName} `;
  return props.heading.startsWith(prefix)
    ? props.heading.slice(prefix.length)
    : props.heading;
}

const filePath = computed(() => resolveFilePath());

const isNewFile = computed(() => {
  const input = parseToolInput(props.toolInput);
  return input.exists === false;
});

const bodyLines = computed<string[]>(() => {
  if (!props.body) return [];
  return props.body.split("\n");
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
        <CopyButton :text="props.body" />
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
          :code="props.body"
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
