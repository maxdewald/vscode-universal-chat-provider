import type {
  ProxyModelListEntry,
  ProxyModelMetadata,
} from '@src/chat/models/model'
import type { ProxyRequestBody } from '@src/chat/requests/request-builder'
import type { BeforeErrorHook, KyInstance } from 'ky'
import { Type } from '@sinclair/typebox'
import { ProxyModelListEntrySchema, ProxyModelMetadataSchema } from '@src/chat/models/model'
import { codexCitations } from '@src/cliproxy/api/codex-citations'
import { ProxyHttpError } from '@src/cliproxy/api/errors'
import {
  emitWebSearchStep,
  streamErrorMessage,
  StreamEventSchema,
  StreamItemSchema,
  streamKey,
  StreamResponseSchema,
  textPartBuffer,
  thinkingSectionEmitter,
  toolCallAssembler,
} from '@src/cliproxy/api/responses-stream'
import { asJsonValue, asValue } from '@src/shared/json'
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

const ErrorBodySchema = Type.Object({
  error: Type.Optional(Type.Union([Type.String(), Type.Object({ message: Type.Optional(Type.String()) })])),
  message: Type.Optional(Type.String()),
})

const ModelsListSchema = Type.Object({
  data: Type.Optional(Type.Array(ProxyModelListEntrySchema)),
}, { additionalProperties: true })

const ModelsMetadataSchema = Type.Object({
  models: Type.Optional(Type.Array(ProxyModelMetadataSchema)),
}, { additionalProperties: true })

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
  ): Promise<void> {
    const response = await this.fetcher.post('/v1/responses', {
      json: body,
      signal,
    })
    if (!response.body)
      throw new Error('CLIProxyAPI returned an empty streaming response.')

    const text = textPartBuffer(callbacks.onText, codexCitations)
    const thinking = thinkingSectionEmitter(callbacks.onThinking)
    const tools = toolCallAssembler(callbacks.onToolCall)

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
    try {
      for await (const event of events) {
        if (event.data === '[DONE]')
          break
        const payload = asJsonValue(StreamEventSchema, event.data)
        if (payload === undefined)
          continue
        const type = payload.type ?? event.event

        if (type === 'response.output_text.delta') {
          text.push(streamKey(payload, undefined, payload.content_index ?? 0), payload.delta ?? '')
        }
        else if (type === 'response.content_part.done') {
          text.end(streamKey(payload, undefined, payload.content_index ?? 0), payload.part)
        }
        else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
          thinking.push(payload.delta ?? '')
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
          if (item?.type === 'function_call')
            tools.add(streamKey(payload, item), item)
        }
        else if (type === 'response.function_call_arguments.delta') {
          tools.push(streamKey(payload), payload.delta ?? '')
        }
        else if (type === 'response.output_item.done') {
          const item = asValue(StreamItemSchema, payload.item)
          if (item?.type === 'function_call') {
            tools.end(streamKey(payload, item), item)
          }
          else if (item?.type === 'web_search_call') {
            emitWebSearchStep(item.action, callbacks.onThinking)
          }
          else if (item?.type === 'message') {
            item.content?.forEach((content, contentIndex) => {
              text.end(streamKey(payload, item, contentIndex), content)
            })
          }
        }
        else if (type === 'response.completed') {
          tools.flush()
          const completed = asValue(StreamResponseSchema, payload.response)
          callbacks.onUsage?.(completed?.usage)
        }
        else if (type === 'response.incomplete') {
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
    finally {
      thinking.end()
      text.flush()
    }
  }
}
