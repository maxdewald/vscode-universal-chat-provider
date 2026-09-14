import type { Static } from '@sinclair/typebox'
import type {
  ProxyModelListEntry,
  ProxyModelMetadata,
} from '@src/chat/models/model'
import type { ProxyRequestBody } from '@src/chat/requests/request-builder'
import type { BeforeErrorHook, KyInstance } from 'ky'
import { Type } from '@sinclair/typebox'
import { ProxyModelListEntrySchema, ProxyModelMetadataSchema } from '@src/chat/models/model'
import { emitWebSearchStep } from '@src/cliproxy/api/codex-response'
import { ProxyHttpError } from '@src/cliproxy/api/errors'
import { asValue } from '@src/shared/json'
import { kyFetch } from '@src/shared/kyFetch'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { isHTTPError } from 'ky'

export interface DiscoveryResult {
  available: ProxyModelListEntry[]
  metadata: ProxyModelMetadata[]
}

export interface StreamCallbacks {
  onText: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolCall: (callId: string, name: string, input: object) => void
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
  action: Type.Optional(Type.Unknown()),
})

const StreamResponseSchema = Type.Object({
  usage: Type.Optional(Type.Unknown()),
  incomplete_details: Type.Optional(Type.Union([
    Type.Null(),
    Type.Object({ reason: Type.Optional(Type.String()) }),
  ])),
  error: Type.Optional(Type.Union([Type.Null(), Type.String(), ErrorObjectSchema])),
})

const StreamEventSchema = Type.Object({
  type: Type.Optional(Type.String()),
  delta: Type.Optional(Type.String()),
  item: Type.Optional(Type.Unknown()),
  item_id: Type.Optional(Type.String()),
  output_index: Type.Optional(Type.Unknown()),
  response: Type.Optional(Type.Unknown()),
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
    this.fetcher = kyFetch.extend({
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
    sessionId?: string,
  ): Promise<void> {
    const response = await this.fetcher.post('/v1/responses', {
      json: body,
      signal,
      headers: sessionId === undefined ? {} : { 'X-Session-Id': sessionId },
    })
    if (!response.body)
      throw new Error('CLIProxyAPI returned an empty streaming response.')

    const pending = new Map<string, PendingToolCall>()
    const emitted = new Set<string>()
    let hasThinking = false
    const endThinking = (): void => {
      if (hasThinking) {
        callbacks.onThinking?.('')
        hasThinking = false
      }
    }

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
    for await (const event of events) {
      if (event.data === '[DONE]') {
        endThinking()
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
      else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        if (payload.delta !== undefined && payload.delta.length > 0) {
          callbacks.onThinking?.(payload.delta)
          hasThinking = true
        }
      }
      else if (
        type === 'response.reasoning_summary_text.done'
        || type === 'response.reasoning_summary_part.done'
        || type === 'response.reasoning_text.done'
      ) {
        endThinking()
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
        else if (item?.type === 'web_search_call') {
          emitWebSearchStep(item.action, callbacks.onThinking)
        }
      }
      else if (type === 'response.completed') {
        endThinking()
        for (const call of pending.values())
          emitToolCall(call, callbacks, emitted)
        const completed = asValue(StreamResponseSchema, payload.response)
        callbacks.onUsage?.(completed?.usage)
      }
      else if (type === 'response.incomplete') {
        endThinking()
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
