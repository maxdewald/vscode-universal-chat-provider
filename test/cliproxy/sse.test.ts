import { describe, expect, it } from 'vitest'
import { parseServerSentEvents } from '../../src/cliproxy/sse'

describe('server-sent event parser', () => {
  it('handles split chunks, event names, comments, and multiline data', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': keepalive\r\nevent: response.output_text.delta\r\ndata: {"del'))
        controller.enqueue(encoder.encode('ta":"hello"}\r\n\r\ndata: first\ndata: second\n\n'))
        controller.close()
      },
    })

    const events = []
    for await (const event of parseServerSentEvents(stream))
      events.push(event)

    expect(events).toEqual([
      {
        event: 'response.output_text.delta',
        data: '{"delta":"hello"}',
      },
      {
        data: 'first\nsecond',
      },
    ])
  })

  it('handles a CRLF boundary split across chunks and discards an unterminated final event', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\r'))
        controller.enqueue(encoder.encode('\n\r\ndata: second\r'))
        controller.close()
      },
    })

    const events = []
    for await (const event of parseServerSentEvents(stream))
      events.push(event)

    // Per the SSE spec, pending data at end-of-stream (no terminating blank
    // line) is discarded, so the trailing `data: second` is not emitted.
    expect(events).toEqual([{ data: 'first' }])
  })

  it('ignores blocks without data', async () => {
    const stream = new Response('event: ping\n\n: comment\n\n').body!
    const events = []
    for await (const event of parseServerSentEvents(stream))
      events.push(event)
    expect(events).toEqual([])
  })
})
