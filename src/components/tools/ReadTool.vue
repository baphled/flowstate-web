<script setup lang="ts">
import { ref, computed } from "vue";
import CopyButton from "./CopyButton.vue";
import HighlightedCode from "./HighlightedCode.vue";
import ToolBubble from "./ToolBubble.vue";
import { resolveFileLang } from "@/lib/fileLang";
import type { ToolRendererProps } from "./toolRendererProps";

interface ReadLine {
  number: number;
  text: string;
}

// Long reads are expensive to lay out and rarely consumed in full — show the
// head + tail with an ellipsis marker and let the user expand (BashTool
// toggle pattern).
const FULL_CONTENT_THRESHOLD = 500;
const HEAD_LINE_COUNT = 200;
const TAIL_LINE_COUNT = 50;

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

// The path comes from toolInput when present ({"file_path": "...", "limit":
// ..., "offset": ...}); otherwise strip the leading "<toolName> " prefix off
// the heading.
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

/**
 * Strip opencode's XML-like wrapper tags from a read body:
 *
 *   <path>/tmp/x.txt</path>
 *   <type>file</type>
 *   <content>
 *   ...file lines...
 *   </content>
 *
 * The <content> payload wins when present; otherwise drop lone path/type tag
 * lines and keep the rest as-is.
 */
function extractFileContent(body: string): string {
  const wrapped = body.match(/<content[^>]*>([\s\S]*)<\/content>/);
  if (wrapped) {
    return wrapped[1].replace(/^\n/, "").replace(/\n$/, "");
  }
  return body
    .split("\n")
    .filter((line) => !/^\s*<\/?(path|type|content)>\s*$/.test(line))
    .join("\n");
}

const filePath = computed(() => resolveFilePath());

const contentLines = computed<string[]>(() => {
  const content = extractFileContent(props.body);
  if (!content) return [];
  return content.split("\n");
});

const startLine = computed(() => {
  const input = parseToolInput(props.toolInput);
  const offset = typeof input.offset === "number" ? input.offset : 0;
  return offset + 1;
});

const numberedLines = computed<ReadLine[]>(() =>
  contentLines.value.map((text, i) => ({
    number: startLine.value + i,
    text,
  })),
);

const isLongContent = computed(
  () => contentLines.value.length > FULL_CONTENT_THRESHOLD,
);

const showFull = ref(false);

const tailLines = computed<ReadLine[]>(() => {
  if (!isLongContent.value) return [];
  return numberedLines.value.slice(-TAIL_LINE_COUNT);
});

const hiddenLineCount = computed(() => {
  if (!isLongContent.value) return 0;
  return Math.max(
    0,
    contentLines.value.length - HEAD_LINE_COUNT - TAIL_LINE_COUNT,
  );
});

const displayLines = computed<ReadLine[]>(() => {
  if (!isLongContent.value || showFull.value) {
    return numberedLines.value;
  }
  return [
    ...numberedLines.value.slice(0, HEAD_LINE_COUNT),
    ...tailLines.value,
  ];
});

const lineRange = computed(() => {
  const input = parseToolInput(props.toolInput);
  const limit = typeof input.limit === "number" ? input.limit : undefined;
  const offset = typeof input.offset === "number" ? input.offset : undefined;

  if (limit === undefined && offset === undefined) return null;

  const start = (offset ?? 0) + 1;
  const end = (offset ?? 0) + (limit ?? 0);
  return `lines ${start}–${end}`;
});

const readFileLang = computed<string | undefined>(() =>
  resolveFileLang(filePath.value),
);

/** Line text for the highlighted path — mirrors displayLines (head +
 *  tail for long files) so the highlighted view honours the same
 *  truncation as the gutter view. */
const displayContent = computed<string>(() =>
  displayLines.value.map((line) => line.text).join("\n"),
);

function toggleShowFull(): void {
  showFull.value = !showFull.value;
}
</script>

<template>
  <ToolBubble
    :tool-name="props.toolName"
    :title="props.toolName"
    :subtitle="props.heading"
    :status="props.status"
    :default-open="true"
  >
    <div class="tool-renderer" data-component="read-tool">
      <div class="tool-renderer__header">
        <span class="tool-renderer__path" data-testid="read-file-path">{{
          props.heading
        }}</span>
        <CopyButton v-if="!readFileLang" :text="props.body" />
      </div>
      <div class="tool-read-summary" data-testid="read-summary">
        <span class="tool-read-summary__text"
          >{{ contentLines.length }} lines from {{ filePath }}</span
        >
        <span
          v-if="lineRange"
          class="tool-renderer__line-range"
          data-testid="line-range"
          >[{{ lineRange }}]</span
        >
      </div>
      <HighlightedCode
        v-if="readFileLang"
        :code="displayContent"
        :lang="readFileLang"
        max-height="none"
      />
      <pre
        v-else
        class="tool-code tool-code--read tool-code--lines"
        data-component="read-content"
      ><code><div
          v-for="line in displayLines"
          :key="line.number"
          class="read-line"
          data-testid="read-line"
          :data-line-number="line.number"
        ><span class="line-gutter">{{ line.number }}</span><span class="line-content">{{ line.text }}</span></div><div
          v-if="isLongContent && !showFull"
          class="read-ellipsis"
          data-testid="read-ellipsis"
        >… {{ hiddenLineCount }} lines hidden</div></code></pre>
      <button
        v-if="isLongContent"
        type="button"
        class="read-tool-toggle"
        data-component="read-toggle"
        :aria-expanded="showFull ? 'true' : 'false'"
        @click="toggleShowFull"
      >
        {{ showFull ? "Show less" : "Show full output" }}
      </button>
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

.tool-read-summary {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 0.8rem;
  font-weight: 600;
}

.tool-read-summary__text {
  color: var(--text-secondary, #a9b1d6);
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

.tool-code--lines {
  padding: 0.5rem 0;
}

.read-line {
  display: grid;
  grid-template-columns: 4ch 1fr;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0 0.5rem;
  color: var(--text-primary, #c0caf5);
  white-space: pre-wrap;
}

.read-line:hover {
  background: var(--surface-mid, rgba(148, 163, 184, 0.08));
}

.line-gutter {
  color: var(--text-muted, #565f89);
  font-size: 0.7rem;
  text-align: right;
  user-select: none;
}

.line-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.read-ellipsis {
  padding: 0.25rem 0.5rem;
  color: var(--text-muted, #565f89);
  font-size: 0.78rem;
  font-style: italic;
  user-select: none;
}

.read-tool-toggle {
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

.read-tool-toggle:hover,
.read-tool-toggle:focus-visible {
  color: var(--text-primary, #c0caf5);
  border-color: var(--text-secondary, #a9b1d6);
  outline: none;
}
</style>
