<script setup lang="ts">
import { computed } from "vue";
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
  if (props.status === "pending" || props.status === "running") {
    return "Waiting for answer";
  }
  if (props.status === "error") {
    return "Question failed";
  }
  return "Answered";
});
</script>

<template>
  <div class="question-tool" data-testid="question-tool">
    <span class="question-tool__question">{{ heading }}</span>
    <span class="question-tool__status">
      <span data-testid="question-tool-label">{{ label }}</span>
      <span
        class="question-tool__glyph"
        :class="{ 'question-tool__glyph--spinning': status === 'pending' || status === 'running' }"
        data-testid="question-tool-glyph"
      >{{ glyph }}</span>
    </span>
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
