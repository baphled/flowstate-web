import { computed, ref, type ComputedRef, type Ref } from "vue"
import type { TurnStateQuestionRequest } from '@/api'

/**
 * Question selector state machine — opencode-style option list driven
 * by the keyboard (ArrowUp/ArrowDown to move, Space/Enter to choose)
 * with a mouse-click path and an "Other" free-text row.
 *
 * Exposed as a composable so the unit suite can drive transitions
 * without mounting a component, mirroring useInputTriggers.
 */
export interface QuestionSelectorState {
  /** Index of the highlighted (current) row within the render list. */
  highlightIndex: number
  /** Selected option strings (single entry unless allow_multiple). */
  selected: string[]
  /** Free-text answer; non-empty when the operator chose "Other". */
  freeText: string
}

export interface QuestionSelectorReturn {
  /** Keyboard/controller state for one pending question. */
  state: Ref<QuestionSelectorState>
  /** Options plus the trailing "Other" free-text row. */
  rows: ComputedRef<string[]>
  isOtherRow: (index: number) => boolean
  isSelected: (option: string) => boolean
  moveUp: () => void
  moveDown: () => void
  toggleCurrent: () => void
  clickRow: (index: number) => void
  /** Answers the Enter key should submit; null when not submittable. */
  buildAnswers: () => string[] | null
}

export const OTHER_ROW_LABEL = 'Other…'

/**
 * Drives selection state for one pending question request. The caller
 * owns submission (chatStore.answerQuestion) so the composable stays
 * render-agnostic.
 */
export function useQuestionSelector(
  request: () => TurnStateQuestionRequest,
): QuestionSelectorReturn {
  const options = computed(() =>
    Array.isArray(request().options) ? request().options! : [],
  )
  const allowMultiple = computed(() => request().allow_multiple === true)
  const rows = computed(() =>
    options.value.length > 0 ? [...options.value, OTHER_ROW_LABEL] : [],
  )
  const state = ref<QuestionSelectorState>({
    highlightIndex: 0,
    selected: [],
    freeText: '',
  })

  function isOtherRow(index: number): boolean {
    return rows.value.length > 0 && index === rows.value.length - 1
  }

  function isSelected(option: string): boolean {
    return state.value.selected.includes(option)
  }

  function moveUp(): void {
    if (rows.value.length === 0) return
    state.value.highlightIndex =
      (state.value.highlightIndex - 1 + rows.value.length) % rows.value.length
  }

  function moveDown(): void {
    if (rows.value.length === 0) return
    state.value.highlightIndex = (state.value.highlightIndex + 1) % rows.value.length
  }

  function setSingle(option: string): void {
    state.value.selected = [option]
  }

  function toggle(option: string): void {
    const idx = state.value.selected.indexOf(option)
    if (idx === -1) state.value.selected.push(option)
    else state.value.selected.splice(idx, 1)
  }

  function toggleCurrent(): void {
    const row = rows.value[state.value.highlightIndex]
    if (row === undefined) return
    if (isOtherRow(state.value.highlightIndex)) return
    if (allowMultiple.value) toggle(row)
    else setSingle(row)
  }

  function clickRow(index: number): void {
    if (index < 0 || index >= rows.value.length) return
    state.value.highlightIndex = index
    toggleCurrent()
  }

  function buildAnswers(): string[] | null {
    const trimmed = state.value.freeText.trim()
    if (isOtherRow(state.value.highlightIndex)) {
      return trimmed === '' ? null : [trimmed]
    }
    if (state.value.selected.length > 0) return [...state.value.selected]
    return trimmed === '' ? null : [trimmed]
  }

  return {
    state,
    rows,
    isOtherRow,
    isSelected,
    moveUp,
    moveDown,
    toggleCurrent,
    clickRow,
    buildAnswers,
  }
}
