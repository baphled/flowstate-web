/**
 * Voice Push-to-Talk (Aug 2026) — /api/v1/voice/transcribe client.
 *
 * Contract (agent-platform internal/api/voice_fe.go):
 *   POST /api/v1/voice/transcribe, multipart 'audio' field, WAV only
 *   (webm rejected 400), 10 MiB cap, 200 → { "transcript": "..." }.
 *   501 voice_not_wired when voice disabled; 503 voice_unavailable
 *   when the local whisper binary is missing. Both 501/503 must NOT
 *   block the composer — the caller shows a non-blocking hint.
 */

import { joinBaseURL } from '@/api'
import { webmBlobToWav } from '@/lib/voiceWav'

const CREDENTIALS_INCLUDE: RequestCredentials = 'include'

export type VoiceUnavailableReason = 'voice_not_wired' | 'voice_unavailable'

export class VoiceTranscribeError extends Error {
  readonly status: number
  readonly reason: VoiceUnavailableReason | null

  constructor(status: number, reason: VoiceUnavailableReason | null, message: string) {
    super(message)
    this.name = 'VoiceTranscribeError'
    this.status = status
    this.reason = reason
  }

  /** Non-blocking degradation cases — hint, don't block the composer. */
  get isUnavailable(): boolean {
    return this.reason !== null
  }
}

export interface TranscribeResult {
  transcript: string
}

/**
 * Convert a MediaRecorder blob to WAV and POST it to the transcribe
 * endpoint. Throws VoiceTranscribeError on 501/503 (isUnavailable true —
 * caller shows a hint) and on transport/4xx/5xx errors.
 */
export async function transcribeRecording(
  blob: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscribeResult> {
  // Convert FIRST: posting the raw webm blob would be rejected with 400.
  const wav = await webmBlobToWav(blob)
  const form = new FormData()
  form.append('audio', wav, 'recording.wav')

  const res = await fetchImpl(joinBaseURL('/v1/voice/transcribe'), {
    method: 'POST',
    credentials: CREDENTIALS_INCLUDE,
    body: form,
  })

  if (res.status === 501) {
    throw new VoiceTranscribeError(
      501,
      'voice_not_wired',
      'Voice input is not enabled on this server.',
    )
  }
  if (res.status === 503) {
    throw new VoiceTranscribeError(
      503,
      'voice_unavailable',
      'Speech transcription is unavailable (whisper not installed).',
    )
  }
  if (!res.ok) {
    throw new VoiceTranscribeError(res.status, null, `Transcription failed: ${res.status}`)
  }

  const data = (await res.json()) as { transcript?: unknown }
  return { transcript: typeof data.transcript === 'string' ? data.transcript : '' }
}
