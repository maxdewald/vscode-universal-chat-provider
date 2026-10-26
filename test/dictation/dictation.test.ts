import { Buffer } from 'node:buffer'
import { clipPrompt, engineChoices, transcribeLive, untilLive, upsample16kTo24k, wav } from '@src/dictation/dictation'
import { describe, expect, it, vi } from 'vitest'

const codex = { proxyModelId: 'gpt-6-luna', proxyOwner: 'openai' }
const gemini = { proxyModelId: 'gemini-3-flash', proxyOwner: 'antigravity' }
const geminiImage = { proxyModelId: 'gemini-3.1-flash-image', proxyOwner: 'antigravity' }
const claude = { proxyModelId: 'claude-sonnet-5-5', proxyOwner: 'anthropic' }

describe('engineChoices', () => {
  it('offers None, the Codex transcription models, and every Gemini model that can hear audio', () => {
    const newGemini = { proxyModelId: 'gemini-9-flash', proxyOwner: 'antigravity' }
    const choices = engineChoices([claude, geminiImage, gemini, newGemini, codex])
    expect(choices.map(choice => choice.id)).toEqual(['', 'gpt-transcribe', 'gpt-live-transcribe', 'gemini-3-flash', 'gemini-9-flash'])
    expect(choices.at(-1)?.description).toBe('Gemini · transcribes after you stop')
  })

  it('offers only None without an audio-capable account', () => {
    expect(engineChoices([claude]).map(choice => choice.id)).toEqual([''])
  })
})

describe('clipPrompt', () => {
  it('names the expected language and keeps the vocabulary hint', () => {
    expect(clipPrompt('de')).toContain('most likely speaking German')
    expect(clipPrompt(undefined)).not.toContain('most likely')
    expect(clipPrompt(undefined)).toContain('Software development dictation')
  })
})

describe('audio helpers', () => {
  it('writes a 16-bit mono WAV header', () => {
    const file = wav(Buffer.alloc(32000), 16000)
    expect(file.toString('ascii', 0, 4)).toBe('RIFF')
    expect(file.readUInt32LE(24)).toBe(16000)
    expect(file.readUInt32LE(40)).toBe(32000)
    expect(file.length).toBe(32044)
  })

  it('upsamples 16 kHz to 24 kHz by interpolation', () => {
    expect([...upsample16kTo24k(Int16Array.from([0, 300, 600, 900]))]).toEqual([0, 200, 400, 600, 800, 900])
  })
})

describe('untilLive', () => {
  async function* frames(...values: number[]): AsyncGenerator<Int16Array> {
    for (const value of values)
      yield Int16Array.from([value, value])
  }
  async function collect(source: AsyncGenerator<Int16Array>): Promise<number[]> {
    const values: number[] = []
    for await (const frame of source)
      values.push(frame[0]!)
    return values
  }

  it('skips leading digital silence and keeps every frame from the first real one', async () => {
    expect(await collect(await untilLive(frames(0, 0, 5, 0, 7)))).toEqual([5, 0, 7])
  })

  it('gives up waiting after the limit so a silent microphone still records', async () => {
    expect(await collect(await untilLive(frames(0, 0, 0), 0))).toEqual([0, 0, 0])
  })
})

class FakeRealtimeSocket {
  static readonly OPEN = 1
  static instance: FakeRealtimeSocket
  readyState = 0
  sent: Array<{ type: string }> = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void

  constructor(readonly url: string) {
    FakeRealtimeSocket.instance = this
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
    })
  }

  send(data: string): void {
    const message = JSON.parse(data) as { type: string }
    this.sent.push(message)
    if (message.type === 'input_audio_buffer.commit') {
      for (const event of [
        { type: 'input_audio_buffer.committed', item_id: 'a' },
        { type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'Hello' },
        { type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'Hello world.' },
      ])
        this.onmessage?.({ data: JSON.stringify(event) })
    }
  }

  close(): void {}
}

describe('transcribeLive', () => {
  it('streams audio and resolves with the completed transcript', async () => {
    vi.stubGlobal('WebSocket', FakeRealtimeSocket)
    async function* frames(): AsyncGenerator<Int16Array> {
      yield new Int16Array(1600)
    }
    const text = await transcribeLive('http://127.0.0.1:1', 'key', 'gpt-transcribe', frames())

    expect(text).toBe('Hello world.')
    expect(FakeRealtimeSocket.instance.url).toBe('ws://127.0.0.1:1/v1/realtime?model=gpt-realtime')
    expect(FakeRealtimeSocket.instance.sent.map(message => message.type)).toEqual(['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit'])
  })
})
