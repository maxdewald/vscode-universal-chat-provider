import type { LanguageModelChatRequestMessage } from 'vscode'
import { getEncoding } from 'js-tiktoken'

const encoding = getEncoding('o200k_base')

export function countTokens(value: string | LanguageModelChatRequestMessage): number {
  if (typeof value === 'string')
    return encoding.encode(value).length

  let count = 4
  if (value.name !== undefined && value.name.length > 0)
    count += encoding.encode(value.name).length
  for (const part of value.content) {
    count += 3
    if (isTextPart(part))
      count += encoding.encode(part.value).length
    else if (isDataPart(part))
      count += part.mimeType.startsWith('image/') ? 256 : encoding.encode(new TextDecoder().decode(part.data)).length
    else
      count += encoding.encode(JSON.stringify(part)).length
  }
  return count
}

function isTextPart(value: unknown): value is { value: string } {
  return typeof value === 'object' && value !== null && typeof (value as { value?: unknown }).value === 'string'
}

function isDataPart(value: unknown): value is { data: Uint8Array, mimeType: string } {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as { data?: unknown, mimeType?: unknown }
  return candidate.data instanceof Uint8Array && typeof candidate.mimeType === 'string'
}
