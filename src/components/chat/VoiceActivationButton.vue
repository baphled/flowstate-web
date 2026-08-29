<script setup lang="ts">
/**
 * Voice Push-to-Talk (Aug 2026) — composer mic button.
 *
 * Hold-to-talk: pointerdown starts a MediaRecorder capture, pointerup
 * (or pointerleave/pointercancel) stops it, converts the webm/opus blob
 * to mono 16-bit PCM WAV client-side (the /v1/voice/transcribe endpoint
 * rejects webm with 400), POSTs it, and emits the transcript for the
 * composer to insert at the caret.
 *
 * Degradation contract: 501 (voice_not_wired) and 503
 * (voice_unavailable) responses surface a NON-BLOCKING hint toast —
 * the composer stays fully usable for typing. Other failures (mic
 * denied, network, 400) also toast but never throw into the composer.
 */
import { onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { showToast } from '@/composables/useToast'
import { transcribeRecording, VoiceTranscribeError } from '@/lib/voiceApi'

defineOptions({ name: 'VoiceActivationButton' })

const emit = defineEmits<{
  (e: 'transcript', text: string): void
}>()

const isRecording = ref(false)
const isTranscribing = ref(false)

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stopping = false

/** True when MediaRecorder is usable in this browser. */
function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== 'undefined'
  )
}

async function startRecording(): Promise<void> {
  if (isRecording.value || isTranscribing.value) return
  if (!isSupported()) {
    showToast({
      title: 'Voice input unavailable',
      message: 'This browser does not support audio recording.',
      variant: 'error',
      duration: 4000,
    })
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(stream)
    chunks = []
    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = (): void => {
      // Release the mic immediately — never hold it while transcribing.
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
      void handleBlob(blob)
    }
    recorder.start()
    isRecording.value = true
  } catch {
    showToast({
      title: 'Microphone blocked',
      message: 'Grant microphone permission to use voice input.',
      variant: 'error',
      duration: 4000,
    })
  }
}

function stopRecording(): void {
  if (!recorder || recorder.state === 'inactive') {
    isRecording.value = false
    return
  }
  stopping = true
  recorder.stop()
  isRecording.value = false
}

async function handleBlob(blob: Blob): Promise<void> {
  recorder = null
  stopping = false
  if (blob.size === 0) return
  isTranscribing.value = true
  try {
    const { transcript } = await transcribeRecording(blob)
    const trimmed = transcript.trim()
    if (trimmed) emit('transcript', trimmed)
  } catch (err) {
    if (err instanceof VoiceTranscribeError && err.isUnavailable) {
      // Non-blocking hint: the server has no voice pipeline — typing
      // remains the primary input; do not nag with an error variant.
      showToast({
        title: 'Voice input not available',
        message: err.message,
        variant: 'default',
        duration: 4000,
      })
      return
    }
    showToast({
      title: 'Transcription failed',
      message: err instanceof Error ? err.message : 'Unknown error.',
      variant: 'error',
      duration: 4000,
    })
  } finally {
    isTranscribing.value = false
  }
}

function handlePointerdown(event: PointerEvent): void {
  // Prevent the textarea stealing focus mid-press and text-selection
  // side effects of a long hold.
  event.preventDefault()
  void startRecording()
}

function handlePointerup(): void {
  if (stopping) return
  stopRecording()
}

onBeforeUnmount(() => {
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null
    recorder.stream.getTracks().forEach((t) => t.stop())
    recorder = null
  }
  isRecording.value = false
})
</script>

<template>
  <button
    type="button"
    class="voice-button"
    :class="{ 'is-recording': isRecording, 'is-transcribing': isTranscribing }"
    data-testid="voice-button"
    :aria-label="isRecording ? 'Stop voice recording' : 'Hold to talk'"
    :title="isRecording ? 'Release to transcribe' : 'Hold to talk'"
    :disabled="isTranscribing"
    @pointerdown="handlePointerdown"
    @pointerup="handlePointerup"
    @pointerleave="handlePointerup"
    @pointercancel="handlePointerup"
  >
    <span v-if="isRecording" class="voice-pulse" data-testid="voice-recording-indicator" />
    <span v-else-if="isTranscribing" class="voice-status">…</span>
    <Icon v-else name="mic" :size="18" />
  </button>
</template>

<style scoped>
.voice-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.voice-button:hover:not(:disabled) {
  color: var(--text, #ddd);
}

.voice-button.is-recording {
  color: #e5484d;
}

.voice-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.voice-pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e5484d;
  animation: voice-pulse 1s ease-in-out infinite;
}

@keyframes voice-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.6);
    opacity: 0.5;
  }
}

.voice-status {
  font-size: 14px;
  line-height: 1;
}
</style>
