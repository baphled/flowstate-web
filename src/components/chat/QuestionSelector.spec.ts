import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import QuestionSelector from './QuestionSelector.vue'
import { useChatStore } from '@/stores/chatStore'
import type { TurnStateQuestionRequest } from '@/api'

/**
 * QuestionSelector specs — pin the opencode-style composer selector
 * (Aug 2026 BDD feature: question-selector.feature). Mirrors the
 * QuestionPrompt.spec.ts store-stubbing pattern: stub the store
 * action, not fetch.
 */

function installLocalStorageStub(): void {
  const store = new Map<string, string>()
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  })
}

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


describe('QuestionSelector', () => {
  beforeEach(() => {
    installLocalStorageStub()
    setActivePinia(createPinia())
  })

  it('renders question text and option rows including Other', () => {
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    expect(wrapper.find('[data-testid="question-selector-question"]').text()).toBe('Deploy now?')
    const rows = wrapper.findAll('[data-testid^="question-selector-row-"]')
    expect(rows).toHaveLength(4)
    expect(rows[0].attributes('data-option')).toBe('Yes')
    expect(rows[3].attributes('data-option')).toBe('Other…')
  })

  it('highlights the first row initially and moves with arrow keys', async () => {
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    const root = wrapper.find('[data-testid="question-selector"]')
    await root.trigger('keydown', { key: 'ArrowDown' })
    await root.trigger('keydown', { key: 'ArrowDown' })
    const highlighted = wrapper.findAll('.question-selector__row--highlighted')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].attributes('data-option')).toBe('Maybe')
  })

  it('Enter submits the highlighted option via chatStore.answerQuestion', async () => {
    const store = useChatStore()
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerQuestion = answerSpy
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    const root = wrapper.find('[data-testid="question-selector"]')
    await root.trigger('keydown', { key: 'ArrowDown' })
    await root.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(answerSpy).toHaveBeenCalledWith('q-1', ['No'])
  })

  it('space toggles multiple selections when allow_multiple', async () => {
    const store = useChatStore()
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerQuestion = answerSpy
    const wrapper = mount(QuestionSelector, {
      props: { request: makeRequest({ allow_multiple: true }) },
    })
    const root = wrapper.find('[data-testid="question-selector"]')
    await root.trigger('keydown', { key: ' ' })
    await root.trigger('keydown', { key: 'ArrowDown' })
    await root.trigger('keydown', { key: 'ArrowDown' })
    await root.trigger('keydown', { key: ' ' })
    await root.trigger('keydown', { key: 'Enter' })
    expect(answerSpy).toHaveBeenCalledWith('q-1', ['Yes', 'Maybe'])
  })

  it('Other row reveals free text and submits it', async () => {
    const store = useChatStore()
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerQuestion = answerSpy
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    const root = wrapper.find('[data-testid="question-selector"]')
    for (let i = 0; i < 3; i++) {
      await root.trigger('keydown', { key: 'ArrowDown' })
    }
    const otherInput = wrapper.find('[data-testid="question-selector-other-input"]')
    expect(otherInput.exists()).toBe(true)
    await otherInput.setValue('blue')
    await otherInput.trigger('keydown.enter')
    expect(answerSpy).toHaveBeenCalledWith('q-1', ['blue'])
  })

  it('no options renders the free-text input', () => {
    const wrapper = mount(QuestionSelector, {
      props: { request: makeRequest({ options: undefined }) },
    })
    expect(wrapper.find('[data-testid="question-selector-input"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="question-selector-row-"]')).toHaveLength(0)
  })

  it('Escape collapses the selector without answering', async () => {
    const store = useChatStore()
    const answerSpy = vi.fn()
    store.answerQuestion = answerSpy
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    await wrapper.find('[data-testid="question-selector"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="question-selector"]').exists()).toBe(false)
    expect(answerSpy).not.toHaveBeenCalled()
  })

  it('click selects and Submit sends the answers', async () => {
    const store = useChatStore()
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerQuestion = answerSpy
    const wrapper = mount(QuestionSelector, { props: { request: makeRequest() } })
    await wrapper.findAll('[data-testid^="question-selector-row-"]')[2].trigger('click')
    await wrapper.find('[data-testid="question-selector-submit"]').trigger('click')
    expect(answerSpy).toHaveBeenCalledWith('q-1', ['Maybe'])
  })
})
