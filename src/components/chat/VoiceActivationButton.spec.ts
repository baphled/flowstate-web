import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VoiceActivationButton from './VoiceActivationButton.vue'

// The component only uses showToast for hints/errors — stub it so the
// assertions run against the mock, not a real toast store.
vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}))

// transcribeRecording is the seam the button depends on; the WAV
// conversion + POST behaviour has its own specs (voiceApi.spec.ts).
// VoiceTranscribeError must remain instanceof-compatible with the
// component's import, hence the mock class export.
vi.mock('@/lib/voiceApi', () => {
  class VoiceTranscribeError extends Error {
    status: number
    reason: 'voice_not_wired' | 'voice_unavailable' | null
    constructor(
      status: number,
      reason: 'voice_not_wired' | 'voice_unavailable' | null,
      message?: string,
    ) {
      super(message ?? reason ?? `transcribe failed (${status})`)
      this.status = status
      this.reason = reason
    }
    get isUnavailable(): boolean {
      return this.reason !== null
    }
  }
  return {
    transcribeRecording: vi.fn(),
    VoiceTranscribeError,
  }
})

import { showToast } from '@/composables/useToast'
import { transcribeRecording, VoiceTranscribeError } from '@/lib/voiceApi'

const transcriptMock = vi.mocked(transcribeRecording)
const toastMock = vi.mocked(showToast)

/**
 * Build a MediaRecorder stub whose stop() fires the same event order a
 * real recorder does: dataavailable (with a fake chunk) then stop. The
 * component reads `mimeType` when reassembling the blob.
 */
function makeRecorderStub(): new () => MediaRecorder {
  return function (this: any) {
    let stopCb: (() => void) | null = null
    const self: any = {
      state: 'inactive',
      mimeType: 'audio/webm',
      stream: { getTracks: () => [{ stop: () => {} }] },
      start: () => {
        self.state = 'recording'
      },
      stop: () => {
        self.state = 'inactive'
        self.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) })
        stopCb?.()
      },
      ondataavailable: null as ((e: BlobEvent) => void) | null,
    }
    Object.defineProperty(self, 'onstop', {
      get: () => stopCb,
      set: (fn: (() => void) | null) => {
        stopCb = fn
      },
    })
    return self
  } as unknown as new () => MediaRecorder
}

async function pressAndRelease(wrapper: Awaited<ReturnType<typeof mountButton>>) {
  const btn = wrapper.find('[data-testid="voice-button"]')
  await btn.trigger('pointerdown')
  await flushPromises()
  await btn.trigger('pointerup')
  await flushPromises()
}

async function mountButton() {
  return mount(VoiceActivationButton, {
    global: { stubs: { Icon: true } },
  })
}

describe('VoiceActivationButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    transcriptMock.mockReset()

    // Plain-function globals: vi.fn(() => recorder) is not constructible
    // under jsdom's `new MediaRecorder()` path.
    vi.stubGlobal('MediaRecorder', makeRecorderStub())
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts recording on pointerdown and shows the recording indicator', async () => {
    const wrapper = await mountButton()
    await wrapper.find('[data-testid="voice-button"]').trigger('pointerdown')
    await flushPromises()
    expect(wrapper.find('[data-testid="voice-recording-indicator"]').exists()).toBe(true)
  })

  it('emits transcript after pointerup and successful transcription', async () => {
    transcriptMock.mockResolvedValue({ transcript: 'hello from voice' })
    const wrapper = await mountButton()
    await pressAndRelease(wrapper)
    expect(transcriptMock).toHaveBeenCalledTimes(1)
    const [blob] = transcriptMock.mock.calls[0] as unknown as [Blob]
    expect(blob.type).toBe('audio/webm')
    expect(wrapper.emitted('transcript')?.[0]).toEqual(['hello from voice'])
  })

  it('shows a non-blocking hint toast on 501 voice_not_wired', async () => {
    transcriptMock.mockRejectedValue(
      new VoiceTranscribeError(501, 'voice_not_wired', 'hint'),
    )
    const wrapper = await mountButton()
    await pressAndRelease(wrapper)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect((toastMock.mock.calls[0][0] as { variant: string }).variant).toBe('default')
    expect(wrapper.emitted('transcript')).toBeUndefined()
  })

  it('shows a non-blocking hint toast on 503 voice_unavailable', async () => {
    transcriptMock.mockRejectedValue(
      new VoiceTranscribeError(503, 'voice_unavailable', 'hint'),
    )
    const wrapper = await mountButton()
    await pressAndRelease(wrapper)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect((toastMock.mock.calls[0][0] as { variant: string }).variant).toBe('default')
  })

  it('shows an error toast (not a hint) on a blocking transcription failure', async () => {
    transcriptMock.mockRejectedValue(new VoiceTranscribeError(400, null, 'bad'))
    const wrapper = await mountButton()
    await pressAndRelease(wrapper)
    expect((toastMock.mock.calls[0][0] as { variant: string }).variant).toBe('error')
  })

  it('toasts when the browser lacks MediaRecorder support', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const wrapper = await mountButton()
    await wrapper.find('[data-testid="voice-button"]').trigger('pointerdown')
    await flushPromises()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="voice-recording-indicator"]').exists()).toBe(false)
  })
})
