import { describe, expect, it } from 'vitest'
import { downmixToMono, encodeWav, floatTo16BitPCM, webmBlobToWav } from './voiceWav'

function fakeAudioBuffer(channels: Float32Array[], sampleRate = 16000): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer
}

function readAscii(view: DataView, offset: number, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += String.fromCharCode(view.getUint8(offset + i))
  return out
}

describe('floatTo16BitPCM', () => {
  it('maps -1..1 to -32768..32767 and rails out-of-range input', () => {
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    floatTo16BitPCM(view, 0, new Float32Array([0, 1, -1, 2]))
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(32767)
    expect(view.getInt16(4, true)).toBe(-32768)
    expect(view.getInt16(6, true)).toBe(32767) // 2 clamped to 1
  })
})

describe('encodeWav', () => {
  it('produces a canonical RIFF/WAVE mono 16-bit header', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000)
    const view = new DataView(wav)
    expect(wav.byteLength).toBe(44 + 3 * 2)
    expect(readAscii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 6)
    expect(readAscii(view, 8, 4)).toBe('WAVE')
    expect(readAscii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits
    expect(readAscii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6)
    // 0.5 * 0x7fff = 16383.5; setInt16 truncates toward zero → 16383
    expect(view.getInt16(46, true)).toBe(16383)
  })
})

describe('downmixToMono', () => {
  it('copies single-channel buffers', () => {
    const src = new Float32Array([1, -1])
    const out = downmixToMono(fakeAudioBuffer([src]))
    expect(Array.from(out)).toEqual([1, -1])
    expect(out).not.toBe(src) // owns its array
  })

  it('averages stereo channels', () => {
    const out = downmixToMono(
      fakeAudioBuffer([new Float32Array([1, 0]), new Float32Array([0, -1])]),
    )
    expect(Array.from(out)).toEqual([0.5, -0.5])
  })
})

describe('webmBlobToWav', () => {
  it('decodes via the injected context and returns a WAV blob', async () => {
    const ctx = {
      decodeAudioData: async (_data: ArrayBuffer) =>
        fakeAudioBuffer([new Float32Array([0, 0.25])], 16000),
    }
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
    const wav = await webmBlobToWav(blob, ctx)
    expect(wav.type).toBe('audio/wav')
    const buf = await wav.arrayBuffer()
    expect(readAscii(new DataView(buf), 0, 4)).toBe('RIFF')
    expect(buf.byteLength).toBe(44 + 2 * 2)
  })
})
