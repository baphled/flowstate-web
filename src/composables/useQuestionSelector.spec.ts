import { describe, expect, it } from 'vitest'
import { useQuestionSelector, OTHER_ROW_LABEL } from './useQuestionSelector'
import type { TurnStateQuestionRequest } from '@/api'

/**
 * useQuestionSelector specs — pin the opencode-style keyboard state
 * machine (Aug 2026 BDD feature: question-selector.feature).
 */

function makeRequest(overrides: Partial<TurnStateQuestionRequest> = {}): TurnStateQuestionRequest {
  return {
    request_id: 'q-1',
    tool_name: 'question',
    question: 'Deploy now?',
    options: ['Yes', 'No', 'Maybe'],
    allow_multiple: false,
    status: 'pending',
    ...overrides,
  }
}

describe('useQuestionSelector', () => {
  it('renders options plus the trailing Other row', () => {
    const s = useQuestionSelector(() => makeRequest())
    expect(s.rows.value).toEqual(['Yes', 'No', 'Maybe', OTHER_ROW_LABEL])
  })

  it('arrow keys wrap the highlight', () => {
    const s = useQuestionSelector(() => makeRequest())
    s.moveDown()
    s.moveDown()
    expect(s.state.value.highlightIndex).toBe(2)
    s.moveUp()
    expect(s.state.value.highlightIndex).toBe(1)
    s.moveUp()
    s.moveUp()
    expect(s.state.value.highlightIndex).toBe(3) // wraps to Other row
  })

  it('single select: toggle replaces the selection', () => {
    const s = useQuestionSelector(() => makeRequest())
    s.toggleCurrent() // highlights index 0 → Yes
    expect(s.state.value.selected).toEqual(['Yes'])
    s.moveDown()
    s.toggleCurrent()
    expect(s.state.value.selected).toEqual(['No'])
  })

  it('multi select: space accumulates and deselects', () => {
    const s = useQuestionSelector(() => makeRequest({ allow_multiple: true }))
    s.toggleCurrent()
    s.moveDown()
    s.moveDown()
    s.toggleCurrent()
    expect(s.state.value.selected).toEqual(['Yes', 'Maybe'])
    s.toggleCurrent()
    expect(s.state.value.selected).toEqual(['Yes'])
  })

  it('Other row returns the trimmed free text', () => {
    const s = useQuestionSelector(() => makeRequest())
    s.state.value.highlightIndex = 3
    s.state.value.freeText = '  blue  '
    expect(s.buildAnswers()).toEqual(['blue'])
  })

  it('Other row with empty text is not submittable', () => {
    const s = useQuestionSelector(() => makeRequest())
    s.state.value.highlightIndex = 3
    expect(s.buildAnswers()).toBeNull()
  })

  it('selected options build the answers array', () => {
    const s = useQuestionSelector(() => makeRequest({ allow_multiple: true }))
    s.toggleCurrent()
    s.moveDown()
    s.toggleCurrent()
    expect(s.buildAnswers()).toEqual(['Yes', 'No'])
  })

  it('no options yields no rows', () => {
    const s = useQuestionSelector(() => makeRequest({ options: undefined }))
    expect(s.rows.value).toEqual([])
    expect(s.buildAnswers()).toBeNull()
  })

  it('clickRow highlights and toggles', () => {
    const s = useQuestionSelector(() => makeRequest())
    s.clickRow(2)
    expect(s.state.value.highlightIndex).toBe(2)
    expect(s.state.value.selected).toEqual(['Maybe'])
  })
})
