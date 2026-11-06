<script lang="ts">
export { RENDER_MAX_LINES, RENDER_MAX_BYTES } from "./bashToolConstants";
</script>

<script setup lang="ts">
import { ref, computed } from "vue";
import CopyButton from "./CopyButton.vue";
import HighlightedCode from "./HighlightedCode.vue";
import ToolBubble from "./ToolBubble.vue";
import type { ToolRendererProps } from "./toolRendererProps";
import { RENDER_MAX_LINES, RENDER_MAX_BYTES } from "./bashToolConstants";

const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "completed",
});

// Exec tool (Nov 2026): opt-in, allow-listed command execution with no
// network access. Mirrors BashTool's UX contract so the two card shapes
// stay consistent: silent-success category (collapsed on success, forced
// open on error), command preview in the subtitle, capped output render.
const cardDefaultOpen = computed(() => props.status === "error");

const showFull = ref(true);

// Denied output heuristic: the engine rejects allow-list misses /
// network-attempting commands with a short refusal. Surface it as an
// explicit permission note so the user sees *why* nothing ran.
const wasDenied = computed(
  () =>
    props.status === "error" &&
    /allow-?list|not permitted|denied|network/i.test(props.body),
);

interface SliceResult {
  body: string;
  hiddenLines: number;
}

function sliceForRender(body: string): SliceResult {
  let slice =
    body.length > RENDER_MAX_BYTES ? body.slice(0, RENDER_MAX_BYTES) : body;
  if (slice.length < body.length) {
    const lastNewline = slice.lastIndexOf("\n");
    if (lastNewline > 0) {
      slice = slice.slice(0, lastNewline);
    }
  }

  const lines = slice.split("\n");
  if (lines.length > RENDER_MAX_LINES) {
    slice = lines.slice(0, RENDER_MAX_LINES).join("\n");
  }

  const totalLines = body.split("\n").length;
  const renderedLines = slice.split("\n").length;
  const hiddenLines = Math.max(0, totalLines - renderedLines);
  return { body: slice, hiddenLines };
}

const renderSlice = computed(() => sliceForRender(props.body));

const bodyTruncated = computed(() => renderSlice.value.hiddenLines > 0);

const displayedBody = computed(() => {
  if (showFull.value || !bodyTruncated.value) {
    return props.body;
  }
  return renderSlice.value.body;
});

const toggleLabel = computed(() =>
  showFull.value ? "Show less" : "Show full output",
);
const toggleAriaLabel = computed(() =>
  showFull.value ? "Hide full output" : "Show full output",
);

function toggle() {
  showFull.value = !showFull.value;
}
</script>

<template>
  <ToolBubble
    :tool-name="props.toolName"
    :title="props.toolName"
    :subtitle="props.heading"
    :status="props.status"
    :default-open="cardDefaultOpen"
  >
    <div class="tool-renderer" data-component="exec-tool">
      <section class="tool-section">
        <div class="tool-section__header">
          <span class="tool-section__label">Command</span>
          <CopyButton :text="props.heading" />
        </div>
        <pre
          class="tool-code tool-code--exec"
          data-component="exec-command"
        ><code>{{ props.heading }}</code></pre>
        <p class="exec-sandbox-hint" data-component="exec-sandbox-hint">
          Allow-listed command · no network sandbox
        </p>
      </section>

      <p v-if="wasDenied" class="exec-denied" data-component="exec-denied">
        Blocked: command rejected by the exec allow-list (no network, opt-in
        commands only).
      </p>

      <section v-if="props.body" class="tool-section" data-component="exec-output">
        <span class="tool-section__label">Output</span>
        <HighlightedCode
          :code="displayedBody"
          lang="bash"
          max-height="none"
        />
        <p
          v-if="bodyTruncated && !showFull"
          class="exec-tool-truncation-hint"
          data-component="exec-output-truncation-hint"
        >
          {{ renderSlice.hiddenLines }} lines hidden. Click "Show full output"
          to view all.
        </p>
        <button
          v-if="bodyTruncated"
          type="button"
          class="exec-tool-toggle"
          data-component="exec-output-toggle"
          :aria-label="toggleAriaLabel"
          :aria-expanded="showFull ? 'true' : 'false'"
          @click="toggle"
        >
          {{ toggleLabel }}
        </button>
      </section>
    </div>
  </ToolBubble>
</template>

<style scoped>
.tool-renderer {
  display: grid;
  gap: 0.85rem;
}

.tool-section {
  display: grid;
  gap: 0.45rem;
}

.tool-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.tool-section__label {
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tool-code {
  margin: 0;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.25));
  border-radius: calc(var(--radius, 12px) - 4px);
  background: var(--surface-low, #1a1b26);
  color: var(--text-primary, #c0caf5);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.exec-sandbox-hint {
  margin: 0;
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.72rem;
  font-style: italic;
}

.exec-denied {
  margin: 0;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--danger, rgba(247, 118, 142, 0.5));
  border-radius: calc(var(--radius, 12px) - 6px);
  color: var(--danger, #f7768e);
  font-size: 0.8rem;
}

.exec-tool-truncation-hint {
  margin: 0;
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-style: italic;
}

.exec-tool-toggle {
  align-self: flex-start;
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.25));
  border-radius: calc(var(--radius, 12px) - 6px);
  background: var(--surface-low, #1a1b26);
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
}

.exec-tool-toggle:hover,
.exec-tool-toggle:focus-visible {
  color: var(--text-primary, #c0caf5);
  border-color: var(--text-secondary, #a9b1d6);
  outline: none;
}
</style>
