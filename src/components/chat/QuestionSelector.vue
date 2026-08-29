<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import type { TurnStateQuestionRequest } from '@/api'
import { useQuestionSelector } from '@/composables/useQuestionSelector'

/**
 * QuestionSelector — opencode-style option list rendered above the
 * chat composer while a blocking question tool call is pending.
 *
 * Keyboard contract (mirrors opencode's answer selector):
 *   ArrowUp / ArrowDown move the highlight, Space toggles the
 *   highlighted option (multi-select when allow_multiple), Enter
 *   submits the selection, Escape collapses the selector without
 *   answering. Mouse users click a row to select, then Submit.
 *
 * An "Other…" row is appended whenever options exist so free-text
 * answers remain reachable; questions with no options render a plain
 * free-text input bound to Enter.
 *
 * Submission routes through chatStore.answerQuestion (POST
 * /question-answer) — the long-poll diff observes the answered status
 * flip and pendingQuestions drops the entry, unmounting the card
 * across every open tab.
 */
defineOptions({ name: 'QuestionSelector' })

const props = defineProps<{
  request: TurnStateQuestionRequest
}>()

const chatStore = useChatStore()
const localError = ref('')
const collapsed = ref(false)

const selector = useQuestionSelector(() => props.request)
const allowMultiple = computed(() => props.request.allow_multiple === true)

const hasOptions = computed(() => selector.rows.value.length > 0)
const isSubmitting = computed(() =>
  chatStore.answeringQuestionRequests.has(props.request.request_id),
)

async function submit(): Promise<void> {
  if (isSubmitting.value) return
  localError.value = ''
  const answers = hasOptions.value ? selector.buildAnswers() : [freeTextAnswer.value.trim()]
  if (!answers || answers.length === 0 || answers[0] === '') {
    localError.value = 'Select an option or type an answer first.'
    return
  }
  try {
    await chatStore.answerQuestion(props.request.request_id, answers)
  } catch (err) {
    localError.value =
      err instanceof Error ? err.message : 'Failed to send answer. Try again.'
  }
}

const freeTextAnswer = ref('')

async function handleKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selector.moveUp()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selector.moveDown()
    return
  }
  if (event.key === ' ') {
    event.preventDefault()
    selector.toggleCurrent()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (selector.isOtherRow(selector.state.value.highlightIndex)) return
    // opencode behaviour: Enter picks the highlighted row when no
    // explicit selection has been made (single-select fast path).
    if (!allowMultiple.value && selector.state.value.selected.length === 0) {
      selector.toggleCurrent()
    }
    await submit()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    collapsed.value = !collapsed.value
  }
}

function handleOtherEnter(): void {
  void submit()
}
</script>

<template>
  <div
    v-if="!collapsed"
    class="question-selector"
    role="group"
    aria-label="Question from agent"
    data-testid="question-selector"
    :data-request-id="props.request.request_id"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <p class="question-selector__question" data-testid="question-selector-question">
      {{ props.request.question }}
    </p>
    <ul
      v-if="hasOptions"
      class="question-selector__rows"
      role="listbox"
      :aria-multiselectable="props.request.allow_multiple === true"
      data-testid="question-selector-rows"
    >
      <li
        v-for="(row, index) in selector.rows.value"
        :key="row"
        class="question-selector__row"
        :class="{
          'question-selector__row--highlighted':
            selector.state.value.highlightIndex === index,
          'question-selector__row--selected': selector.isSelected(row),
        }"
        role="option"
        :aria-selected="selector.isSelected(row)"
        :data-testid="`question-selector-row-${index}`"
        :data-option="row"
        @click="selector.clickRow(index)"
        @mouseenter="selector.state.value.highlightIndex = index"
      >
        <span
          class="question-selector__marker"
          aria-hidden="true"
          >{{ selector.isSelected(row) ? '●' : '○' }}</span
        >
        <span class="question-selector__label">{{ row }}</span>
      </li>
    </ul>
    <div
      v-if="hasOptions && selector.isOtherRow(selector.state.value.highlightIndex)"
      class="question-selector__other"
    >
      <input
        v-model="selector.state.value.freeText"
        type="text"
        class="question-selector__input"
        data-testid="question-selector-other-input"
        placeholder="Type your answer…"
        :disabled="isSubmitting"
        @keydown.enter.prevent="handleOtherEnter"
      />
    </div>
    <div v-if="!hasOptions" class="question-selector__freetext">
      <input
        v-model="freeTextAnswer"
        type="text"
        class="question-selector__input"
        data-testid="question-selector-input"
        placeholder="Type your answer… (Enter to submit)"
        :disabled="isSubmitting"
        @keydown.enter.prevent="submit"
      />
    </div>
    <div class="question-selector__footer">
      <button
        type="button"
        class="question-selector__btn"
        data-testid="question-selector-submit"
        :disabled="isSubmitting"
        @click="submit"
      >
        {{ isSubmitting ? 'Submitting…' : 'Submit' }}
      </button>
      <span class="question-selector__hint">↑↓ move · space select · Enter submit · Esc dismiss</span>
    </div>
    <div
      v-if="localError"
      class="question-selector__error"
      role="alert"
      data-testid="question-selector-error"
    >
      {{ localError }}
    </div>
  </div>
</template>

<style scoped>
.question-selector {
  margin: 0 0 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--accent, #b88dff);
  border-radius: 0.5rem;
  background: var(--bg-elevated, rgba(184, 141, 255, 0.06));
  font-size: 0.875rem;
}
.question-selector:focus-within {
  outline: 1px solid var(--accent, #b88dff);
}
.question-selector__question {
  margin: 0 0 0.5rem;
  font-weight: 600;
}
.question-selector__rows {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
}
.question-selector__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
}
.question-selector__row--highlighted {
  background: var(--accent-soft, rgba(184, 141, 255, 0.25));
}
.question-selector__row--selected .question-selector__label {
  font-weight: 600;
}
.question-selector__marker {
  font-size: 0.75rem;
}
.question-selector__input {
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}
.question-selector__footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.question-selector__btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.8125rem;
  cursor: pointer;
}
.question-selector__btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
.question-selector__hint {
  font-size: 0.75rem;
  opacity: 0.7;
}
.question-selector__error {
  margin-top: 0.5rem;
  color: var(--color-permission-danger, #c53030);
  font-size: 0.8125rem;
}
</style>
