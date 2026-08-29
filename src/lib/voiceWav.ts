/**
 * Voice Push-to-Talk (Aug 2026) — browser audio → WAV conversion.
 *
 * The backend endpoint POST /api/v1/voice/transcribe accepts WAV only
 * (RIFF/WAVE header; webm is rejected with 400). Browsers' MediaRecorder
 * produces webm/opus (or mp4 on Safari), so the recorded blob must be
 * decoded and re-encoded client-side before upload:
 *
 *   MediaRecorder blob (webm/opus)
 *     → AudioContext.decodeAudioData
 *     → downmix to mono
 *     → 16-bit little-endian PCM
 *     → canonical 44-byte-header WAV
 *
 * The pure functions (floatTo16BitPCM, encodeWav) are exported for unit
 * testing; webmBlobToWav is the browser-facing entry point and requires
 * a decode-capable AudioContext (injected for testability).
 */

/** Write Float32 samples as 16-bit little-endian PCM into a DataView. */
export function floatTo16BitPCM(
  view: DataView,
  offset: number,
  input: Float32Array,
): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    // Round rather than truncate so the ±1 rails land exactly on
    // -32768 / 32767 instead of overflowing via float error.
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

/**
 * Encode mono Float32 samples as a canonical WAV file (RIFF/WAVE, PCM
 * 16-bit, mono) in a fresh ArrayBuffer. sampleRate is written into the
 * fmt chunk verbatim — callers decide the target rate.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);
  return buffer;
}

/** Downmix an AudioBuffer to a mono Float32Array (average of channels). */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    // Copy so the caller owns the array independently of the AudioBuffer.
    const copy = new Float32Array(buffer.length);
    copy.set(buffer.getChannelData(0));
    return copy;
  }
  const out = new Float32Array(buffer.length);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < buffer.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += channels[c][i];
    }
    out[i] = sum / channels.length;
  }
  return out;
}

/** Minimal decode surface AudioContext must expose for webmBlobToWav. */
export interface DecodeCapableContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

/**
 * Convert a MediaRecorder blob (webm/opus, mp4, …) to a mono 16-bit PCM
 * WAV Blob ready for POST /api/v1/voice/transcribe. The AudioContext is
 * injected so unit tests can pass a stub; production callers omit it and
 * get a fresh browser AudioContext.
 */
export async function webmBlobToWav(blob: Blob, ctx?: DecodeCapableContext): Promise<Blob> {
  const context: DecodeCapableContext = ctx ?? new AudioContext()
  const arrayBuffer = await blob.arrayBuffer()
  const decoded = await context.decodeAudioData(arrayBuffer)
  const mono = downmixToMono(decoded)
  const wav = encodeWav(mono, decoded.sampleRate)
  return new Blob([wav], { type: 'audio/wav' })
}
