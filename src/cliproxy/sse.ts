import { EventSourceParserStream } from 'eventsource-parser/stream'

export interface ServerSentEvent {
  event?: string
  data: string
}

export async function* parseServerSentEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())

  for await (const { event, data } of events)
    yield { ...(event === undefined ? {} : { event }), data }
}
