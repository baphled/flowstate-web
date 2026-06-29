<script setup lang="ts">
import { computed } from "vue";
import ToolBubble from "./ToolBubble.vue";
import type { ToolRendererProps } from "./toolRendererProps";

const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "completed",
});

// The heading carries the full file path (e.g. "/tmp/example.txt").
// Show it as the subtitle so the user knows which file was read.
// File contents are intentionally not displayed in the card.

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

const lineRange = computed(() => {
  const input = parseToolInput(props.toolInput);
  const limit = typeof input.limit === "number" ? input.limit : undefined;
  const offset = typeof input.offset === "number" ? input.offset : undefined;

  if (limit === undefined && offset === undefined) return null;

  const start = (offset ?? 0) + 1;
  const end = (offset ?? 0) + (limit ?? 0);
  return `lines ${start}–${end}`;
});
</script>

<template>
  <!-- Read card: shows the full file path being read, without file contents. -->
  <ToolBubble
    :tool-name="props.toolName"
    :title="props.toolName"
    :subtitle="props.heading"
    :status="props.status"
    :default-open="false"
  >
    <div class="tool-renderer" data-component="read-tool">
      <div class="tool-renderer__header">
        <span class="tool-renderer__path" data-testid="read-file-path">{{
          props.heading
        }}</span>
        <span
          v-if="lineRange"
          class="tool-renderer__line-range"
          data-testid="line-range"
          >[{{ lineRange }}]</span
        >
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

.tool-renderer__path {
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-renderer__line-range {
  font-size: 0.75rem;
  color: var(--text-muted, #565f89);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
}
</style>
