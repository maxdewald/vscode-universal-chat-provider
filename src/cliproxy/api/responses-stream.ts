import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'

const ErrorObjectSchema = Type.Object({
  message: Type.Optional(Type.String()),
})

export const StreamItemSchema = Type.Object({
  type: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  call_id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  arguments: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  action: Type.Optional(Type.Unknown()),
  content: Type.Optional(Type.Array(Type.Unknown())),
})

export const StreamResponseSchema = Type.Object({
  usage: Type.Optional(Type.Unknown()),
  incomplete_details: Type.Optional(Type.Union([
    Type.Null(),
    Type.Object({ reason: Type.Optional(Type.String()) }),
  ])),
  error: Type.Optional(Type.Union([Type.Null(), Type.String(), ErrorObjectSchema])),
})

export const StreamEventSchema = Type.Object({
  type: Type.Optional(Type.String()),
  delta: Type.Optional(Type.String()),
  item: Type.Optional(Type.Unknown()),
  item_id: Type.Optional(Type.String()),
  output_index: Type.Optional(Type.Unknown()),
  content_index: Type.Optional(Type.Unknown()),
  part: Type.Optional(Type.Unknown()),
  response: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.Union([Type.String(), ErrorObjectSchema])),
  message: Type.Optional(Type.String()),
})

export type StreamItem = Static<typeof StreamItemSchema>
export type StreamEvent = Static<typeof StreamEventSchema>

const TextContentSchema = Type.Object({
  type: Type.Literal('output_text'),
  text: Type.String(),
  annotations: Type.Optional(Type.Array(Type.Unknown())),
})

const WebActionSchema = Type.Record(Type.String(), Type.Unknown())

const PlainObjectSchema = Type.Object({})

export interface TextRenderer {
  marker: string
  render: (text: string, emittedUtf16Length: number, annotations: unknown[]) => string
}

export function streamKey(payload: StreamEvent, item?: StreamItem, contentIndex?: unknown): string {
  const key = payload.item_id
    ?? item?.id
    ?? item?.call_id
    ?? `output-${String(payload.output_index ?? 'unknown')}`
  return contentIndex === undefined ? key : `${key}:${String(contentIndex)}`
}

export function streamErrorMessage(payload: StreamEvent): string {
  const nested = asValue(StreamResponseSchema, payload.response)
  const error = typeof payload.error === 'string'
    ? undefined
    : payload.error ?? (typeof nested?.error === 'string' ? undefined : nested?.error)
  const stringError = typeof payload.error === 'string'
    ? payload.error
    : typeof nested?.error === 'string' ? nested.error : undefined
  return error?.message ?? stringError ?? payload.message ?? 'CLIProxyAPI response failed.'
}

interface PendingToolCall {
  callId: string
  name: string
  arguments: string
}

export function toolCallAssembler(emit: (callId: string, name: string, input: object) => void): {
  add: (key: string, item: StreamItem) => void
  push: (key: string, delta: string) => void
  end: (key: string, item: StreamItem) => void
  flush: () => void
} {
  const pending = new Map<string, PendingToolCall>()
  const emitted = new Set<string>()
  const create = (key: string, item: StreamItem): PendingToolCall => ({
    callId: item.call_id ?? key,
    name: item.name ?? 'unknown_tool',
    arguments: item.arguments ?? '',
  })
  const complete = (call: PendingToolCall): void => {
    if (emitted.has(call.callId))
      return
    emitted.add(call.callId)
    emit(call.callId, call.name, parseToolInput(call.arguments))
  }
  return {
    add(key, item) {
      pending.set(key, create(key, item))
    },
    push(key, delta) {
      const current = pending.get(key)
      if (current)
        current.arguments += delta
    },
    end(key, item) {
      const current = pending.get(key) ?? create(key, item)
      pending.delete(key)
      if (item.status === 'incomplete')
        return
      current.arguments = item.arguments ?? current.arguments
      complete(current)
    },
    flush() {
      for (const call of pending.values())
        complete(call)
      pending.clear()
    },
  }
}

function parseToolInput(raw: string): object {
  if (!raw.trim())
    return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return asValue(PlainObjectSchema, parsed) ?? { value: parsed }
  }
  catch {
    return { raw }
  }
}

export function textPartBuffer(emit: (delta: string) => void, renderer: TextRenderer): {
  push: (key: string, delta: string) => void
  end: (key: string, value: unknown) => void
  flush: () => void
} {
  const pending = new Map<string, { text: string, emittedUtf16Length: number }>()
  return {
    push(key: string, delta: string) {
      const current = pending.get(key) ?? { text: '', emittedUtf16Length: 0 }
      current.text += delta
      pending.set(key, current)
      const marker = current.text.indexOf(renderer.marker, current.emittedUtf16Length)
      const end = marker < 0 ? current.text.length : marker
      if (end > current.emittedUtf16Length) {
        emit(current.text.slice(current.emittedUtf16Length, end))
        current.emittedUtf16Length = end
      }
    },
    end(key: string, value: unknown) {
      const current = pending.get(key)
      if (current === undefined)
        return
      pending.delete(key)
      const content = asValue(TextContentSchema, value)
      const tail = content?.text === current.text
        ? renderer.render(current.text, current.emittedUtf16Length, content.annotations ?? [])
        : current.text.slice(current.emittedUtf16Length)
      if (tail.length > 0)
        emit(tail)
    },
    flush() {
      for (const current of pending.values()) {
        if (current.emittedUtf16Length < current.text.length)
          emit(current.text.slice(current.emittedUtf16Length))
      }
      pending.clear()
    },
  }
}

export function emitWebSearchStep(
  rawAction: unknown,
  emit?: (delta: string) => void,
): void {
  const action = asValue(WebActionSchema, rawAction)
  const actionType = typeof action?.['type'] === 'string' ? action['type'].trim().replace(/[_-]+/g, ' ') : ''
  const label = actionType.length > 0 ? actionType.charAt(0).toUpperCase() + actionType.slice(1) : 'Web Search'
  const detail = Object.entries(action ?? {})
    .filter(([key, value]) => key !== 'type' && key !== 'sources' && value != null)
    .map(([, value]) => {
      if (typeof value === 'string')
        return value.trim()
      if (Array.isArray(value) && value.every(entry => typeof entry === 'string'))
        return value.map(entry => entry.trim()).filter(Boolean).join(', ')
      return JSON.stringify(value)
    })
    .filter(Boolean)
    .join(', ')
  emit?.(detail.length > 0 ? `${label}: ${detail}` : label)
  emit?.('')
}

export function thinkingSectionEmitter(emit?: (delta: string) => void): { push: (delta: string) => void, end: () => void } {
  let hasEmittedThinking = false

  return {
    push(delta) {
      if (delta.length > 0) {
        emit?.(delta)
        hasEmittedThinking = true
      }
    },
    end() {
      // An empty thinking part tells VS Code the section ended, so the next
      // reasoning summary renders as its own block instead of being appended.
      if (hasEmittedThinking) {
        emit?.('')
        hasEmittedThinking = false
      }
    },
  }
}
