<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import CopyButton from "./CopyButton.vue";
import {
  ensureHighlighterLoaded,
  highlightCode,
  onHighlighterReady,
} from "@/lib/markdownHighlighter";

defineOptions({ name: "HighlightedCode" });

/**
 * Reusable syntax-highlighted code surface for tool outputs. Wraps the
 * existing lazy Shiki setup from markdownHighlighter.ts: plain
 * `<pre><code>` until the highlighter resolves, tokenised HTML after,
 * with a JSON detection/pretty-print pass and a char-cap "Show all"
 * toggle for huge bodies (mirrors the BashTool toggle pattern).
 */
const props = defineProps<{
  code: string;
  lang?: string;
  maxHeight?: string;
}>();

/** Char cap for the "Show all" toggle — only applies when the parent
 *  does not pass an explicit maxHeight (i.e. it manages its own
 *  truncation/scroll and the toggle would fight it). */
const TRUNCATION_LIMIT = 5000;

const highlighterVersion = ref(0);
const showAll = ref(false);
let unsubscribeReady: (() => void) | null = null;

/** True when the raw text is JSON that is already multi-line formatted —
 *  re-stringifying it would only churn the indentation the model or the
 *  tool already chose. */
function isAlreadyFormattedJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  return /\n\s{2,}/.test(raw);
}

/** Pretty-print JSON payloads (objects/arrays) and report whether the
 *  content should be highlighted as json. The explicit lang wins for
 *  everything except "json", which still goes through detection so a
 *  minified tool payload gets formatted before tokenisation. */
function normalizeCode(raw: string): { code: string; isJson: boolean } {
  const explicit = props.lang?.trim().toLowerCase() ?? "";
  const jsonIntent = explicit === "json";

  if (explicit !== "" && explicit !== "json") {
    return { code: raw, isJson: false };
  }
  if (raw.trim() === "") return { code: raw, isJson: jsonIntent };
  if (isAlreadyFormattedJson(raw)) return { code: raw, isJson: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { code: raw, isJson: jsonIntent };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { code: raw, isJson: jsonIntent };
  }
  return { code: JSON.stringify(parsed, null, 2), isJson: true };
}

const normalized = computed(() => normalizeCode(props.code));

const processedCode = computed(() => normalized.value.code);

/** Language handed to Shiki. An unknown/absent lang falls back to "text",
 *  which is outside the supported grammar set — highlightCode returns
 *  null and the component degrades to the plain render. */
const detectedLang = computed(() => {
  const explicit = props.lang?.trim().toLowerCase() ?? "";
  if (explicit !== "" && explicit !== "json") return explicit;
  return normalized.value.isJson ? "json" : "text";
});

const truncationEnabled = computed(
  () => props.maxHeight === undefined && processedCode.value.length > TRUNCATION_LIMIT,
);

const displayCode = computed(() => {
  if (!truncationEnabled.value || showAll.value) return processedCode.value;
  return processedCode.value.slice(0, TRUNCATION_LIMIT);
});

const highlightedHtml = computed<string | null>(() => {
  // Touch the version counter so this recomputes when the lazy-loaded
  // Shiki highlighter resolves (see onHighlighterReady below).
  void highlighterVersion.value;
  return highlightCode(displayCode.value, detectedLang.value);
});

const preStyle = computed<Record<string, string>>(() => ({
  maxHeight: props.maxHeight ?? "400px",
  overflowY: "auto",
}));

function toggleShowAll(): void {
  showAll.value = !showAll.value;
}

onMounted(() => {
  unsubscribeReady = onHighlighterReady(() => {
    highlighterVersion.value += 1;
  });
  // Fire-and-forget — kick off the lazy Shiki load in the background.
  // The version bump above triggers the re-render once it lands.
  void ensureHighlighterLoaded();
});

onUnmounted(() => {
  if (unsubscribeReady !== null) {
    unsubscribeReady();
    unsubscribeReady = null;
  }
});
</script>

<template>
  <div
    class="highlighted-code"
    data-testid="highlighted-code"
    data-component="highlighted-code"
  >
    <div class="highlighted-code__actions">
      <CopyButton :text="props.code" />
    </div>
    <pre
      v-if="highlightedHtml !== null"
      class="highlighted-code__pre"
      :style="preStyle"
      v-html="highlightedHtml"
    />
    <pre
      v-else
      class="highlighted-code__pre"
      :style="preStyle"
      data-testid="highlighted-code-plain"
    ><code>{{ displayCode }}</code></pre>
    <button
      v-if="truncationEnabled"
      type="button"
      class="highlighted-code__toggle"
      data-testid="highlighted-code-toggle"
      :aria-expanded="showAll ? 'true' : 'false'"
      @click="toggleShowAll"
    >
      {{ showAll ? "Show less" : "Show all" }}
    </button>
  </div>
</template>

<style scoped>
.highlighted-code {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}

.highlighted-code__actions {
  display: flex;
  justify-content: flex-end;
}

.highlighted-code__pre {
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

/* Shiki's injected <pre class="shiki"> is a child of our pre (v-html
 * surface) — normalise it so the wrapper's own block styling governs.
 * The per-token --shiki-<key> colours still resolve via themes.css. */
.highlighted-code__pre :deep(.shiki) {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.highlighted-code__pre :deep(.shiki code) {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
}

.highlighted-code__toggle {
  justify-self: start;
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

.highlighted-code__toggle:hover,
.highlighted-code__toggle:focus-visible {
  color: var(--text-primary, #c0caf5);
  border-color: var(--text-secondary, #a9b1d6);
  outline: none;
}
</style>
