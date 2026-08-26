import { describe, expect, it } from 'vitest'
import router from '@/router'

// Session-URI T1 — /chat/s/:id resolves ChatView with the session id param.
describe('router /chat/s/:id route', () => {
  it('resolves /chat/s/session-12345678 to ChatView with params.id', async () => {
    await router.push('/chat/s/session-12345678')
    expect(router.currentRoute.value.name).toBe('chat-session')
    expect(router.currentRoute.value.params.id).toBe('session-12345678')
    expect(router.currentRoute.value.matched[0].components?.default).toBeDefined()
  })

  it('keeps /chat as the unnamed new-session view', async () => {
    await router.push('/chat')
    expect(router.currentRoute.value.name).toBe('chat')
    expect(router.currentRoute.value.params.id).toBeUndefined()
  })
})
