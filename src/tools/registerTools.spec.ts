import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BashTool from '@/components/tools/BashTool.vue'
import CompactStatusTool from '@/components/tools/CompactStatusTool.vue'
import EditTool from '@/components/tools/EditTool.vue'
import GenericTool from '@/components/tools/GenericTool.vue'
import GlobTool from '@/components/tools/GlobTool.vue'
import GrepTool from '@/components/tools/GrepTool.vue'
import ReadTool from '@/components/tools/ReadTool.vue'
import SkillLoadTool from '@/components/tools/SkillLoadTool.vue'
import TodoTool from '@/components/tools/TodoTool.vue'
import WriteTool from '@/components/tools/WriteTool.vue'
import { getToolComponent } from './toolRegistry'
import { registerTools } from './registerTools'

const CopyButton = {
  template: '<span data-testid="copy-btn" />',
}

const ToolBubble = {
  props: ['toolName', 'title', 'subtitle', 'status'],
  template: `
    <div data-testid="tool-bubble" data-component="tool" :data-tool="toolName" :data-status="status">
      <span data-testid="tool-title">{{ title }}</span>
      <span v-if="subtitle" data-testid="tool-subtitle">{{ subtitle }}</span>
      <slot />
    </div>
  `,
}

describe('registerTools', () => {
  it('registers the expected components and aliases', () => {
    registerTools()

    expect(getToolComponent('bash')).toBe(BashTool)
    expect(getToolComponent('read')).toBe(ReadTool)
    expect(getToolComponent('write')).toBe(WriteTool)
    expect(getToolComponent('edit')).toBe(EditTool)
    expect(getToolComponent('multiedit')).toBe(EditTool)
    expect(getToolComponent('apply_patch')).toBe(EditTool)
    expect(getToolComponent('glob')).toBe(GlobTool)
    expect(getToolComponent('list')).toBe(GlobTool)
    expect(getToolComponent('grep')).toBe(GrepTool)
    expect(getToolComponent('skill_load')).toBe(SkillLoadTool)
    expect(getToolComponent('webfetch')).toBe(CompactStatusTool)
    expect(getToolComponent('websearch')).toBe(CompactStatusTool)
    expect(getToolComponent('task')).toBe(GenericTool)
    expect(getToolComponent('todowrite')).toBe(TodoTool)
    // PR7 W1 — `todo_update` is the per-status-transition tool the agent
    // emits after the initial `todowrite`. Its Output is shape-compatible
    // with todowrite (full JSON array of {content,status,priority}) so the
    // same renderer covers both names. Without this registration, every
    // `todo_update` falls through MessageBubble.vue's `?? GenericTool`
    // fallback and the user sees the raw call args + JSON output instead
    // of the checkbox card. See the investigation note
    // "Todo Tools UI Render Gaps (May 2026)" for the full evidence chain.
    expect(getToolComponent('todo_update')).toBe(TodoTool)
    expect(getToolComponent('search_context')).toBe(CompactStatusTool)
    expect(getToolComponent('chain_search_context')).toBe(CompactStatusTool)
    expect(getToolComponent('get_messages')).toBe(CompactStatusTool)
    expect(getToolComponent('chain_get_messages')).toBe(CompactStatusTool)
    expect(getToolComponent('summarize_context')).toBe(CompactStatusTool)
    expect(getToolComponent('coordination_store')).toBe(CompactStatusTool)
  })

  it('returns mountable components after registration', () => {
    registerTools()
    const component = getToolComponent('bash')

    if (!component) {
      throw new Error('bash component was not registered')
    }

    const wrapper = mount(component, {
      props: {
        toolName: 'bash',
        heading: 'pwd',
        body: '/tmp',
      },
      global: {
        stubs: {
          CopyButton,
          ToolBubble,
        },
      },
    })

    expect(wrapper.get('[data-testid="tool-bubble"]').attributes('data-component')).toBe('tool')
    expect(wrapper.get('[data-testid="tool-bubble"]').attributes('data-tool')).toBe('bash')
  })

  it('mounts SkillLoadTool and renders only the skill label line', () => {
    registerTools()
    const component = getToolComponent('skill_load')

    if (!component) {
      throw new Error('skill_load component was not registered')
    }

    const wrapper = mount(component, {
      props: {
        toolName: 'skill_load',
        heading: '→Skill "vue"',
        body: '',
        status: 'completed' as const,
      },
    })

    expect(wrapper.get('[data-testid="skill-load-label"]').text()).toBe(
      '→Skill "vue"',
    )
    expect(wrapper.find('[data-testid="tool-bubble"]').exists()).toBe(false)
  })
})
