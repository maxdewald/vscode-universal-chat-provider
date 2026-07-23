import type { LanguageModelChatRequestMessage } from 'vscode'
import { serializeToolResult } from '@src/chat/requests/request-builder'
import { estimateTokenCount } from 'tokenx'
import {
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from 'vscode'

const MESSAGE_BASE_TOKENS = 4
const PART_BASE_TOKENS = 3
const IMAGE_TOKENS = 256

export function estimateTokens(value: string | LanguageModelChatRequestMessage): number {
  if (typeof value === 'string')
    return estimateTokenCount(value)

  let total = MESSAGE_BASE_TOKENS
  for (const part of value.content) {
    total += PART_BASE_TOKENS
    if (part instanceof LanguageModelTextPart)
      total += estimateTokenCount(part.value)
    else if (part instanceof LanguageModelDataPart)
      total += part.mimeType.startsWith('image/') ? IMAGE_TOKENS : estimateTokenCount(new TextDecoder().decode(part.data))
    else if (part instanceof LanguageModelToolCallPart)
      total += estimateTokenCount(`${part.name}(${JSON.stringify(part.input)})`)
    else if (part instanceof LanguageModelToolResultPart)
      total += estimateTokenCount(serializeToolResult(part))
  }
  return total
}
