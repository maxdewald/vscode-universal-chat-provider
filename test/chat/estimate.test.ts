import type { LanguageModelChatRequestMessage } from 'vscode'
import { estimateTokenCount } from 'tokenx'
import { describe, expect, it } from 'vitest'
import {
  LanguageModelChatMessageRole,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from 'vscode'
import { estimateTokens } from '../../src/chat/estimate'

const MESSAGE_BASE = 4
const PART_BASE = 3
const IMAGE_TOKENS = 256

function message(content: LanguageModelChatRequestMessage['content']): LanguageModelChatRequestMessage {
  return { role: LanguageModelChatMessageRole.User, name: undefined, content }
}

describe('estimateTokens', () => {
  it('counts a raw string with tokenx', () => {
    expect(estimateTokens('Hello, world!')).toBe(estimateTokenCount('Hello, world!'))
  })

  it.each([
    [
      'text parts with framing overhead',
      new LanguageModelTextPart('Hello, world!'),
      MESSAGE_BASE + PART_BASE + estimateTokenCount('Hello, world!'),
    ],
    [
      'image data with a flat allowance',
      LanguageModelDataPart.image(new Uint8Array([1, 2, 3]), 'image/png'),
      MESSAGE_BASE + PART_BASE + IMAGE_TOKENS,
    ],
    [
      'non-image data as text',
      LanguageModelDataPart.text('plain text', 'text/plain'),
      MESSAGE_BASE + PART_BASE + estimateTokenCount('plain text'),
    ],
    [
      'tool calls as serialized text',
      new LanguageModelToolCallPart('id', 'lookup', { q: 'x' }),
      MESSAGE_BASE + PART_BASE + estimateTokenCount(`lookup(${JSON.stringify({ q: 'x' })})`),
    ],
    [
      'tool results as serialized text',
      new LanguageModelToolResultPart('id', [new LanguageModelTextPart('answer')]),
      MESSAGE_BASE + PART_BASE + estimateTokenCount('answer'),
    ],
  ])('counts %s', (_name, part, expected) => {
    expect(estimateTokens(message([part]))).toBe(expected)
  })
})
