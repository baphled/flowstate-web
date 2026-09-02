<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useChatStore } from "@/stores/chatStore";
import { toolNameBasename } from "@/tools/toolRegistry";
import type { ToolRendererProps } from "./toolRendererProps";

/**
 * QuestionTool — dedicated renderer for the blocking clarifying-question
 * tool (Question Tool, Aug 2026).
 *
 * Frontend hardening: without this registration every `question`
 * tool_call falls through MessageBubble.vue's `getToolComponent(name)
 * ?? GenericTool` fallback and renders as a raw tool block with a JSON
 * args blob — exactly the "question tool renders as a generic tool
 * block" symptom. Two failure modes make that fall-through visible:
 *
 *   1. Backend regression — the turn long-poll's `question_requests`
 *      slice never carries a pending entry (or a pre-Aug-2026 server
 *      omits the field entirely). The chatStore diff at
 *      pollTurnUntilTerminal then leaves `pendingQuestions` empty and
 *      neither the inline QuestionPrompt nor the composer takeover
 *      (QuestionSelector) activates.
 *   2. Tool-name mismatch — the entry's `tool_name` doesn't match the
 *      message's `toolName` (e.g. a namespaced `mcp__server__question`
 *      emission), so MessageBubble's exact-match anchor misses.
 *
 * In both cases this renderer keeps the bubble legible: it surfaces the
 * question text from the call args as the heading (via the shared
 * `question` primary-arg key in toolRenderSpec) and shows a waiting
 * glyph while the call is suspended. When the pending-question pipeline
 * IS healthy, the inline QuestionPrompt renders beneath this component
 * and owns the interaction — this card is just the stable base.
 */
const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "pending",
  resolvedQuestion: null,
});

const chatStore = useChatStore();

/**
 * Store cross-check: the tool_call message's status can read
 * "completed" while the question is still unanswered (e.g. the
 * tool_call row is sealed as a terminal-looking message before the
 * answer arrives, or the turn long-poll never carries a resolved
 * question_requests entry). Any pending entry in
 * chatStore.pendingQuestions whose tool_name matches this bubble's
 * tool (via toolNameBasename, so namespaced emissions match too)
 * means the interaction is still open.
 */
const isStillPending = computed(() => {
  const pending = chatStore.pendingQuestions;
  if (!pending) return false;
  const target = toolNameBasename(props.toolName);
  return Object.values(pending).some(
    (entry) =>
      entry?.tool_name &&
      entry.status === "pending" &&
      toolNameBasename(entry.tool_name) === target,
  );
});

/**
 * Answered row (Sept 2026 regression fix) — MessageBubble passes the
 * resolved entry (optimistically latched at answer time, or from the
 * poll diff) so the answered card shows the latched question text AND
 * the operator's answers immediately, without waiting for the poll.
 */
const answeredText = computed<string | null>(() => {
  const entry = props.resolvedQuestion;
  if (!entry || entry.status === "pending") return null;
  if (Array.isArray(entry.answers) && entry.answers.length > 0) {
    return entry.answers.join(", ");
  }
  return null;
});

const glyph = computed(() => {
  switch (props.status) {
    case "pending":
    case "running":
      return "…";
    case "completed":
      return "✓";
    case "error":
      return "✕";
    default:
      return "";
  }
});

const label = computed(() => {
  if (isStillPending.value) {
    return "Waiting for your answer…";
  }
  if (props.status === "pending" || props.status === "running") {
    return "Waiting for answer";
  }
  if (props.status === "error") {
    return "Question failed";
  }
  return "Answered";
});

/**
 * Stable captured question text. Once the question is answered the
 * pendingQuestions store entry is cleared/resolved, so the wire text is
 * no longer available when the bubble re-renders the "Answered" state.
 * Capturing it here the first time it's seen (from the pending entry or
 * the args) keeps the heading showing the question text forever — the
 * tool-name fallback ("question / Answered / ✓" symptom) only applies
 * when neither source ever carried a usable string.
 */
const capturedQuestion = ref<string | null>(null);

/**
 * Heading hardening: prefer the actual question text from the call
 * args (toolInput JSON → args.question). If the args don't carry a
 * usable string, fall back to the tool name — never the raw JSON
 * blob (the `question {"options":[…]}` symptom when the primary-arg
 * heading resolution falls through to compact JSON).
 */
const questionText = computed<string>(() => {
  // Prefer the authoritative wire text from the matching pendingQuestions
  // store entry; the toolInput args and finally the tool name are
  // progressively weaker fallbacks.
  const pendingEntry = Object.values(chatStore.pendingQuestions ?? {}).find(
    (entry) =>
      entry?.tool_name &&
      entry.status === "pending" &&
      toolNameBasename(entry.tool_name) === toolNameBasename(props.toolName) &&
      typeof entry.question === "string" &&
      entry.question.trim() !== "",
  );
  if (pendingEntry) return pendingEntry.question;
  const raw = props.toolInput;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const q = (parsed as Record<string, unknown>).question;
        if (typeof q === "string" && q.trim() !== "") {
          return q;
        }
      }
    } catch {
      // Non-JSON toolInput (legacy bare-string) — not the question
      // text path; fall through to the name fallback.
    }
  }
  // Resolved/answered path: the store entry is gone, but if we
  // captured the question text earlier (or the args still carry it —
  // captured by the watch below) it remains the heading.
  if (capturedQuestion.value !== null) return capturedQuestion.value;
  return props.toolName;
});

// Persist the first usable question text (wire entry or args) into a
// stable ref so the resolved/answered rendering keeps it after the
// pendingQuestions entry is cleared by the poll diff.
watch(
  questionText,
  (text) => {
    if (text !== props.toolName && capturedQuestion.value === null) {
      capturedQuestion.value = text;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="question-tool" data-testid="question-tool">
    <span class="question-tool__question" data-testid="question-tool-question">{{ questionText }}</span>
    <span class="question-tool__status">
      <span data-testid="question-tool-label">{{ label }}</span>
      <span
        class="question-tool__glyph"
        :class="{ 'question-tool__glyph--spinning': status === 'pending' || status === 'running' }"
        data-testid="question-tool-glyph"
      >{{ glyph }}</span>
    </span>
    <span
      v-if="answeredText !== null"
      class="question-tool__answer"
      data-testid="question-tool-answer"
    >{{ answeredText }}</span>
  </div>
</template>

<style scoped>
.question-tool {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.question-tool__question {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.question-tool__status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85em;
  opacity: 0.85;
}

.question-tool__answer {
  font-size: 0.85em;
  opacity: 0.9;
  overflow-wrap: anywhere;
}

.question-tool__glyph--spinning {
  display: inline-block;
  animation: question-tool-pulse 1.2s ease-in-out infinite;
}

@keyframes question-tool-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
