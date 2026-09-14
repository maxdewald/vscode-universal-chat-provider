import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'

const TextContentSchema = Type.Object({
  type: Type.Literal('output_text'),
  text: Type.String(),
  annotations: Type.Optional(Type.Array(Type.Unknown())),
})

const CitationSchema = Type.Object({
  type: Type.Literal('url_citation'),
  start_index: Type.Integer({ minimum: 0 }),
  end_index: Type.Integer({ minimum: 0 }),
  url: Type.String(),
  title: Type.String(),
})

const WebActionSchema = Type.Record(Type.String(), Type.Unknown())

export function citationTextFilter(emit: (delta: string) => void): {
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
      const marker = current.text.indexOf('\uE200', current.emittedUtf16Length)
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
        ? renderCitations(current.text, current.emittedUtf16Length, content.annotations ?? [])
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

function renderCitations(text: string, emittedUtf16Length: number, annotations: unknown[]): string {
  const characters = Array.from(text)
  const replacements = new Map<number, { end: number, links: Set<string> }>()
  for (const value of annotations) {
    const citation = asValue(CitationSchema, value)
    if (citation === undefined || citation.end_index > characters.length || citation.end_index <= citation.start_index)
      continue
    const marker = characters.slice(citation.start_index, citation.end_index).join('')
    if (!/^\uE200cite\uE202[^\uE201]*\uE201$/.test(marker))
      continue
    const url = URL.parse(citation.url)
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:'))
      continue
    const title = (citation.title.trim() || url.hostname)
      .replace(/\s+/g, ' ')
      .replace(/[\\`*_[\]<>]/g, '\\$&')
    const replacement = replacements.get(citation.start_index) ?? { end: citation.end_index, links: new Set<string>() }
    replacement.links.add(`[${title}](<${url.href}>)`)
    replacements.set(citation.start_index, replacement)
  }
  let codePointOffset = Array.from(text.slice(0, emittedUtf16Length)).length
  let result = ''
  const orderedReplacements = [...replacements].sort(([left], [right]) => left - right)
  for (const [start, replacement] of orderedReplacements) {
    if (start < codePointOffset)
      continue
    result += characters.slice(codePointOffset, start).join('') + [...replacement.links].join(' ')
    codePointOffset = replacement.end
  }
  return result + characters.slice(codePointOffset).join('')
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
