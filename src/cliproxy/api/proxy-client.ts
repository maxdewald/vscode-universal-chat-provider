import type { Static } from '@sinclair/typebox'
import type {
  ProxyModelListEntry,
  ProxyModelMetadata,
} from '@src/chat/models/model'
import type { ProxyRequestBody } from '@src/chat/requests/request-builder'
import type { BeforeErrorHook, KyInstance } from 'ky'
import { Type } from '@sinclair/typebox'
import { ProxyModelListEntrySchema, ProxyModelMetadataSchema } from '@src/chat/models/model'
import { ProxyHttpError } from '@src/cliproxy/api/errors'
import { asValue } from '@src/shared/json'
import { isHttpUrl } from '@src/shared/url'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import ky, { isHTTPError } from 'ky'

export interface DiscoveryResult {
  available: ProxyModelListEntry[]
  metadata: ProxyModelMetadata[]
}

export interface WebCitation {
  url: string
  title?: string
}

export interface StreamCallbacks {
  onText: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolCall: (callId: string, name: string, input: object) => void
  onCitation?: (citation: WebCitation) => void
  onUsage?: (usage: unknown) => void
}

interface PendingToolCall {
  callId: string
  name: string
  arguments: string
}

const ErrorObjectSchema = Type.Object({
  message: Type.Optional(Type.String()),
})

const ErrorBodySchema = Type.Object({
  error: Type.Optional(Type.Union([Type.String(), ErrorObjectSchema])),
  message: Type.Optional(Type.String()),
})

const StreamItemSchema = Type.Object({
  type: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  call_id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  arguments: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  content: Type.Optional(Type.Array(Type.Unknown())),
  action: Type.Optional(Type.Unknown()),
})

const UrlCitationSchema = Type.Object({
  type: Type.Literal('url_citation'),
  url: Type.String(),
  title: Type.Optional(Type.String()),
}, { additionalProperties: true })

const OutputTextPartSchema = Type.Object({
  type: Type.Optional(Type.String()),
  annotations: Type.Optional(Type.Array(Type.Unknown())),
}, { additionalProperties: true })

const WebSearchActionSchema = Type.Object({
  queries: Type.Optional(Type.Array(Type.String())),
  sources: Type.Optional(Type.Array(Type.Object({
    type: Type.Optional(Type.String()),
    url: Type.String(),
  }, { additionalProperties: true }))),
}, { additionalProperties: true })

const StreamResponseSchema = Type.Object({
  usage: Type.Optional(Type.Unknown()),
  incomplete_details: Type.Optional(Type.Union([
    Type.Null(),
    Type.Object({ reason: Type.Optional(Type.String()) }),
  ])),
  error: Type.Optional(Type.Union([Type.Null(), Type.String(), ErrorObjectSchema])),
  output: Type.Optional(Type.Array(Type.Unknown())),
})

const StreamEventSchema = Type.Object({
  type: Type.Optional(Type.String()),
  delta: Type.Optional(Type.String()),
  item: Type.Optional(Type.Unknown()),
  item_id: Type.Optional(Type.String()),
  output_index: Type.Optional(Type.Unknown()),
  response: Type.Optional(Type.Unknown()),
  annotation: Type.Optional(Type.Unknown()),
  part: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.Union([Type.String(), ErrorObjectSchema])),
  message: Type.Optional(Type.String()),
})

type StreamItem = Static<typeof StreamItemSchema>
type StreamEvent = Static<typeof StreamEventSchema>

const ModelsListSchema = Type.Object({
  data: Type.Optional(Type.Array(ProxyModelListEntrySchema)),
}, { additionalProperties: true })

const ModelsMetadataSchema = Type.Object({
  models: Type.Optional(Type.Array(ProxyModelMetadataSchema)),
}, { additionalProperties: true })

const PlainObjectSchema = Type.Object({})

const toProxyHttpError: BeforeErrorHook = ({ error }) => {
  if (!isHTTPError(error))
    return error
  const body = error.data
  const objectBody = asValue(ErrorBodySchema, body)
  const message = (typeof objectBody?.error === 'string'
    ? objectBody.error
    : objectBody?.error?.message ?? '').trim()
  || (objectBody?.message ?? '').trim()
  || (typeof body === 'string' ? body.trim() : '')
  return new ProxyHttpError(
    message || `CLIProxyAPI request failed with HTTP ${error.response.status}.`,
    error.response.status,
  )
}

export class CLIProxyClient {
  private readonly fetcher: KyInstance

  constructor(baseUrl: string, apiKey: string) {
    // ponytail: retry:0/timeout:false keep the old raw-fetch behavior (streaming must
    // not time out); ky folds away the auth header, base url, and !ok error parsing.
    this.fetcher = ky.create({
      prefix: baseUrl,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      retry: 0,
      timeout: false,
      hooks: { beforeError: [toProxyHttpError] },
    })
  }

  async discover(signal?: AbortSignal): Promise<DiscoveryResult> {
    const [available, metadata] = await Promise.all([
      this.fetcher.get('/v1/models', { signal: signal ?? null }).json().then(payload => asValue(ModelsListSchema, payload)?.data ?? []),
      this.fetcher.get('/v1/models?client_version=0.114.0', { signal: signal ?? null }).json().then(payload => asValue(ModelsMetadataSchema, payload)?.models ?? []).catch(() => []),
    ])
    return { available, metadata }
  }

  async streamResponse(
    body: ProxyRequestBody,
    callbacks: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.fetcher.post('/v1/responses', {
      json: body,
      signal,
    })
    if (!response.body)
      throw new Error('CLIProxyAPI returned an empty streaming response.')

    const pending = new Map<string, PendingToolCall>()
    const emitted = new Set<string>()
    const citations = new Set<string>()
    const thinking = thinkingSentinelFilter(callbacks.onThinking)

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
    for await (const event of events) {
      if (event.data === '[DONE]') {
        thinking.end()
        break
      }

      let payload: StreamEvent | undefined
      try {
        payload = asValue(StreamEventSchema, JSON.parse(event.data))
      }
      catch {
        continue
      }
      if (payload === undefined)
        continue
      const type = payload.type ?? event.event

      if (type === 'response.output_text.delta') {
        if (payload.delta !== undefined && payload.delta.length > 0)
          callbacks.onText(payload.delta)
      }
      else if (type === 'response.output_text.annotation.added') {
        emitCitation(payload.annotation, callbacks, citations)
      }
      else if (type === 'response.content_part.done') {
        emitPartCitations(payload.part, callbacks, citations)
      }
      else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        if (payload.delta !== undefined && payload.delta.length > 0)
          thinking.push(payload.delta)
      }
      else if (
        type === 'response.reasoning_summary_text.done'
        || type === 'response.reasoning_summary_part.done'
        || type === 'response.reasoning_text.done'
      ) {
        thinking.end()
      }
      else if (type === 'response.output_item.added') {
        const item = asValue(StreamItemSchema, payload.item)
        if (item?.type === 'function_call') {
          const key = toolKey(payload, item)
          pending.set(key, {
            callId: item.call_id ?? key,
            name: item.name ?? 'unknown_tool',
            arguments: item.arguments ?? '',
          })
        }
      }
      else if (type === 'response.function_call_arguments.delta') {
        const key = toolKey(payload)
        const current = pending.get(key)
        if (current)
          current.arguments += payload.delta ?? ''
      }
      else if (type === 'response.output_item.done') {
        const item = asValue(StreamItemSchema, payload.item)
        if (item?.type === 'function_call') {
          const key = toolKey(payload, item)
          if (item.status === 'incomplete') {
            pending.delete(key)
            continue
          }
          const current = pending.get(key) ?? {
            callId: item.call_id ?? key,
            name: item.name ?? 'unknown_tool',
            arguments: '',
          }
          current.arguments = item.arguments ?? current.arguments
          emitToolCall(current, callbacks, emitted)
        }
        else if (item !== undefined) {
          emitWebSearchStep(item, callbacks)
          emitItemCitations(item, callbacks, citations)
        }
      }
      else if (type === 'response.completed') {
        thinking.end()
        for (const call of pending.values())
          emitToolCall(call, callbacks, emitted)
        const completed = asValue(StreamResponseSchema, payload.response)
        for (const item of completed?.output ?? []) {
          const parsed = asValue(StreamItemSchema, item)
          if (parsed !== undefined)
            emitItemCitations(parsed, callbacks, citations)
        }
        callbacks.onUsage?.(completed?.usage)
      }
      else if (type === 'response.incomplete') {
        thinking.end()
        const incomplete = asValue(StreamResponseSchema, payload.response)
        callbacks.onUsage?.(incomplete?.usage)
        const reason = incomplete?.incomplete_details?.reason
        if (reason === 'max_output_tokens')
          return
        if (reason === 'content_filter')
          throw new Error('CLIProxyAPI blocked the response with its content filter.')
        throw new Error(reason !== undefined && reason.length > 0
          ? `CLIProxyAPI returned an incomplete response: ${reason}.`
          : 'CLIProxyAPI returned an incomplete response without a reason.')
      }
      else if (type === 'response.failed' || type === 'error') {
        throw new Error(streamErrorMessage(payload))
      }
    }
  }
}

function emitWebSearchStep(
  item: StreamItem,
  callbacks: StreamCallbacks,
): void {
  if (item.type !== 'web_search_call')
    return
  const action = item.action === undefined ? undefined : asValue(WebSearchActionSchema, item.action)
  const detail = (action?.queries ?? []).map(query => query.trim()).filter(query => query.length > 0).join(', ')
  callbacks.onThinking?.(detail.length > 0 ? `Web Search: ${detail}` : 'Web Search')
  callbacks.onThinking?.('')
}

function emitItemCitations(
  item: StreamItem,
  callbacks: StreamCallbacks,
  emitted: Set<string>,
): void {
  for (const part of item.content ?? [])
    emitPartCitations(part, callbacks, emitted)

  if (item.action === undefined)
    return
  const action = asValue(WebSearchActionSchema, item.action)
  for (const source of action?.sources ?? [])
    emitWebCitation({ url: source.url }, callbacks, emitted)
}

function emitPartCitations(
  value: unknown,
  callbacks: StreamCallbacks,
  emitted: Set<string>,
): void {
  const part = asValue(OutputTextPartSchema, value)
  if (part?.type !== 'output_text')
    return
  for (const annotation of part.annotations ?? [])
    emitCitation(annotation, callbacks, emitted)
}

function emitCitation(
  value: unknown,
  callbacks: StreamCallbacks,
  emitted: Set<string>,
): void {
  const citation = asValue(UrlCitationSchema, value)
  if (citation === undefined)
    return
  emitWebCitation(citation, callbacks, emitted)
}

function emitWebCitation(
  citation: WebCitation,
  callbacks: StreamCallbacks,
  emitted: Set<string>,
): void {
  const url = citation.url.trim()
  const title = citation.title?.trim()
  if (!isHttpUrl(url) || emitted.has(url))
    return
  emitted.add(url)
  callbacks.onCitation?.({
    url,
    ...(title !== undefined && title.length > 0 ? { title } : {}),
  })
}

function thinkingSentinelFilter(emit?: (delta: string) => void): { push: (delta: string) => void, end: () => void } {
  const sentinel = '<!-- -->'
  let tail = ''
  let flushedSinceBoundary = false
  const flush = (value: string): void => {
    if (value.length > 0) {
      emit?.(value)
      flushedSinceBoundary = true
    }
  }

  return {
    push(delta) {
      const value = tail + delta
      tail = ''
      for (let start = value.length - 1; start >= 0; start--) {
        const suffix = value.slice(start)
        if (sentinel.startsWith(suffix) || (suffix.startsWith(sentinel) && suffix.slice(sentinel.length).trim() === '')) {
          tail = suffix
          flush(value.slice(0, start))
          return
        }
      }
      flush(value)
    },
    end() {
      if (tail !== sentinel && !(tail.startsWith(sentinel) && tail.slice(sentinel.length).trim() === ''))
        flush(tail)
      tail = ''
      // An empty thinking part tells VS Code the section ended, so the next
      // reasoning summary renders as its own block instead of being appended.
      if (flushedSinceBoundary) {
        emit?.('')
        flushedSinceBoundary = false
      }
    },
  }
}

function emitToolCall(
  call: PendingToolCall,
  callbacks: StreamCallbacks,
  emitted: Set<string>,
): void {
  if (emitted.has(call.callId))
    return
  emitted.add(call.callId)
  let input: object = {}
  if (call.arguments.trim()) {
    try {
      const parsed: unknown = JSON.parse(call.arguments)
      input = asValue(PlainObjectSchema, parsed) ?? { value: parsed }
    }
    catch {
      input = { raw: call.arguments }
    }
  }
  callbacks.onToolCall(call.callId, call.name, input)
}

function streamErrorMessage(payload: StreamEvent): string {
  const nested = asValue(StreamResponseSchema, payload.response)
  const error = typeof payload.error === 'string'
    ? undefined
    : payload.error ?? (typeof nested?.error === 'string' ? undefined : nested?.error)
  const stringError = typeof payload.error === 'string'
    ? payload.error
    : typeof nested?.error === 'string' ? nested.error : undefined
  return error?.message ?? stringError ?? payload.message ?? 'CLIProxyAPI response failed.'
}

function toolKey(payload: StreamEvent, item?: StreamItem): string {
  return payload.item_id
    ?? item?.id
    ?? item?.call_id
    ?? `output-${String(payload.output_index ?? 'unknown')}`
}
