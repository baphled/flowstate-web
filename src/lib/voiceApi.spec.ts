import { describe, expect, it, vi } from 'vitest'
import { transcribeRecording, VoiceTranscribeError } from './voiceApi'

const wavBytes = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })

// Stub the injected AudioContext path: decode returns a tiny mono buffer,
// so webmBlobToWav yields a valid WAV without a real browser codec.
vi.mock('./voiceWav', async () => {
  const actual = await vi.importActual<typeof import('./voiceWav')>('./voiceWav')
  return {
    ...actual,
    webmBlobToWav: vi.fn(async () => wavBytes),
  }
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('transcribeRecording', () => {
  it('converts to WAV, posts multipart audio and returns the transcript', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('audio') as File
      expect(file.name).toBe('recording.wav')
      return jsonResponse(200, { transcript: 'hello voice' })
    })
    const result = await transcribeRecording(
      new Blob([new Uint8Array([9])], { type: 'audio/webm' }),
      fetchImpl as unknown as typeof fetch,
    )
    expect(result.transcript).toBe('hello voice')
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/v1/voice/transcribe')
  })

  it('throws a non-blocking VoiceTranscribeError on 501 voice_not_wired', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(501, { error: 'voice_not_wired' }),
    )
    try {
      await transcribeRecording(new Blob([]), fetchImpl as unknown as typeof fetch)
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceTranscribeError)
      const e = err as VoiceTranscribeError
      expect(e.status).toBe(501)
      expect(e.reason).toBe('voice_not_wired')
      expect(e.isUnavailable).toBe(true)
    }
  })

  it('throws a non-blocking VoiceTranscribeError on 503 voice_unavailable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: 'voice_unavailable' }),
    )
    try {
      await transcribeRecording(new Blob([]), fetchImpl as unknown as typeof fetch)
      expect.unreachable('should throw')
    } catch (err) {
      const e = err as VoiceTranscribeError
      expect(e.status).toBe(503)
      expect(e.reason).toBe('voice_unavailable')
      expect(e.isUnavailable).toBe(true)
    }
  })

  it('surfaces 400 as a blocking error with no degradation reason', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'bad wav' }))
    try {
      await transcribeRecording(new Blob([]), fetchImpl as unknown as typeof fetch)
      expect.unreachable('should throw')
    } catch (err) {
      const e = err as VoiceTranscribeError
      expect(e.status).toBe(400)
      expect(e.reason).toBeNull()
      expect(e.isUnavailable).toBe(false)
    }
  })
})
