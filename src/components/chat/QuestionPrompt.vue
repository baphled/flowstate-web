<script setup lang="ts">
import { computed, ref } from "vue";
import { useChatStore } from "@/stores/chatStore";
import type { TurnStateQuestionRequest } from "@/api";

/**
 * QuestionPrompt — inline blocking clarifying-question component.
 * Question Tool (Aug 2026). Mirrors PermissionPrompt (Permission Mode
 * ModeAskUser Extension plan, Slice 3, §3).
 *
 * Renders an anchored card beneath the suspended question tool_call
 * bubble carrying the question text, options as toggle buttons
 * (multi-select when allow_multiple) and a free-text fallback. On
 * submit the component routes through chatStore.answerQuestion which
 * POSTs to /api/v1/sessions/{id}/question-answer; the long-poll diff
 * carries the resulting status flip to all open tabs (cross-tab
 * guard, mirroring plan §11 R5 + §17.1).
 *
 * Optimistic state: the submit button shows "Submitting…" while the
 * request is in flight. The flag clears either when the long-poll
 * diff observes the answered status (success path — the entry leaves
 * pendingQuestions so the component unmounts naturally) OR when the
 * POST throws (failure path — store action re-enables the form for
 * retry).
 *
 * Component is intentionally render-only beyond the submit handler —
 * owning the wire shape via the request prop keeps the surface
 * narrow and lets MessageBubble.vue read pendingQuestions and pass
 * exactly one entry in.
 */
defineOptions({ name: "QuestionPrompt" });

const props = defineProps<{
  request: TurnStateQuestionRequest;
}>();

const chatStore = useChatStore();

const localError = ref<string>("");

const selectedOptions = ref<string[]>([]);

const freeText = ref<string>("");

const hasOptions = computed(() =>
  Array.isArray(props.request.options) && props.request.options.length > 0,
);

const allowMultiple = computed(() => props.request.allow_multiple === true);

const isSubmitting = computed(() =>
  chatStore.answeringQuestionRequests.has(props.request.request_id),
);

function toggleOption(option: string): void {
  if (!allowMultiple.value) {
    selectedOptions.value = [option];
    return;
  }
  const idx = selectedOptions.value.indexOf(option);
  if (idx === -1) {
    selectedOptions.value.push(option);
  } else {
    selectedOptions.value.splice(idx, 1);
  }
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return;
  localError.value = "";
  const answers = hasOptions.value
    ? [...selectedOptions.value]
    : [freeText.value.trim()];
  if (answers.length === 0 || answers[0] === "") {
    localError.value = "Select an option or type an answer first.";
    return;
  }
  try {
    await chatStore.answerQuestion(props.request.request_id, answers);
  } catch (err) {
    localError.value =
      err instanceof Error
        ? err.message
        : "Failed to send answer. Click Submit to retry.";
  }
}
</script>

<template>
  <div
    class="question-prompt"
    role="region"
    aria-label="Question from agent"
    data-testid="question-prompt"
    :data-request-id="props.request.request_id"
  >
    <div class="question-prompt__header">
      <span class="question-prompt__icon" aria-hidden="true">❓</span>
      <span class="question-prompt__title">Question from agent</span>
    </div>
    <p
      class="question-prompt__question"
      data-testid="question-prompt-question"
    >
      {{ props.request.question }}
    </p>
    <div
      v-if="hasOptions"
      class="question-prompt__options"
      role="group"
      aria-label="Answer options"
      data-testid="question-prompt-options"
    >
      <button
        v-for="option in props.request.options"
        :key="option"
        type="button"
        class="question-prompt__option"
        :class="{ 'question-prompt__option--selected': selectedOptions.includes(option) }"
        :data-testid="`question-prompt-option`"
        :data-option="option"
        :aria-pressed="selectedOptions.includes(option)"
        :disabled="isSubmitting"
        @click="toggleOption(option)"
      >
        {{ option }}
      </button>
    </div>
    <div v-else class="question-prompt__freetext">
      <input
        v-model="freeText"
        type="text"
        class="question-prompt__input"
        data-testid="question-prompt-input"
        :disabled="isSubmitting"
        placeholder="Type your answer…"
        @keydown.enter.prevent="submit"
      />
    </div>
    <div class="question-prompt__buttons" role="group" aria-label="Submit answer">
      <button
        type="button"
        class="question-prompt__btn"
        data-testid="question-prompt-submit"
        :disabled="isSubmitting"
        @click="submit"
      >
        {{ isSubmitting ? "Submitting…" : "Submit" }}
      </button>
    </div>
    <div
      v-if="localError"
      class="question-prompt__error"
      role="alert"
      data-testid="question-prompt-error"
    >
      {{ localError }}
    </div>
  </div>
</template>

<style scoped>
.question-prompt {
  margin: 0.5rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-permission-ask, #b88dff);
  border-radius: 0.5rem;
  background: var(--color-permission-ask-bg, rgba(184, 141, 255, 0.08));
  font-size: 0.875rem;
}
.question-prompt__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.question-prompt__icon {
  font-size: 1rem;
}
.question-prompt__question {
  margin: 0 0 0.75rem;
  font-weight: 500;
}
.question-prompt__options {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.question-prompt__option {
  padding: 0.375rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.8125rem;
  cursor: pointer;
}
.question-prompt__option--selected {
  background: var(--color-permission-ask, #b88dff);
  color: #fff;
}
.question-prompt__option:disabled {
  opacity: 0.6;
  cursor: progress;
}
.question-prompt__freetext {
  margin-bottom: 0.75rem;
}
.question-prompt__input {
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  box-sizing: border-box;
}
.question-prompt__buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.question-prompt__btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.8125rem;
  cursor: pointer;
}
.question-prompt__btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
.question-prompt__error {
  margin-top: 0.5rem;
  color: var(--color-permission-danger, #c53030);
  font-size: 0.8125rem;
}
</style>
