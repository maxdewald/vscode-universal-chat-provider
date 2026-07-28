import type { LanguageModelChatRequestMessage } from 'vscode'
import { detectCompaction } from '@src/chat/requests/compaction'
import { describe, expect, it } from 'vitest'
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode'
import { userTextMessage } from '../../support/chat'

const SUMMARY_PROMPT = 'Your task is to create a comprehensive, detailed summary of the entire conversation that captures all essential information needed to seamlessly continue the work without any loss of context.'
const SEPARATE_REQUEST = 'Summarize the conversation history so far, paying special attention to the most recent agent commands and tool results that triggered this summarization.'
const INLINE_REQUEST = `The conversation has grown too large for the context window and must be compacted now.\n\n${SUMMARY_PROMPT}\n\nIMPORTANT: Output your summary wrapped in <summary> and </summary> tags.`

function systemMessage(text: string): LanguageModelChatRequestMessage {
  return {
    role: 3 as LanguageModelChatMessageRole,
    content: [new LanguageModelTextPart(text)],
    name: undefined,
  }
}

function assistantMessage(text: string): LanguageModelChatRequestMessage {
  return {
    role: LanguageModelChatMessageRole.Assistant,
    content: [new LanguageModelTextPart(text)],
    name: undefined,
  }
}

describe('compaction detection', () => {
  it('detects the standalone summarizer request', () => {
    const messages = [
      systemMessage(SUMMARY_PROMPT),
      userTextMessage('build the thing'),
      assistantMessage('done'),
      userTextMessage(SEPARATE_REQUEST),
    ]

    expect(detectCompaction(messages)).toBe('separate')
  })

  it('detects the inline agent-loop variant', () => {
    const messages = [
      systemMessage('You are a coding agent.'),
      userTextMessage('build the thing'),
      userTextMessage(INLINE_REQUEST),
    ]

    expect(detectCompaction(messages)).toBe('inline')
  })

  it('ignores a user asking for a summary in their own words', () => {
    const messages = [
      systemMessage('You are a coding agent.'),
      userTextMessage('Summarize the conversation history so far for me please'),
    ]

    expect(detectCompaction(messages)).toBeUndefined()
  })

  it('ignores the summary prompt when the closing request is missing', () => {
    const messages = [
      systemMessage(SUMMARY_PROMPT),
      userTextMessage('carry on with the refactor'),
    ]

    expect(detectCompaction(messages)).toBeUndefined()
  })

  it('ignores ordinary requests', () => {
    expect(detectCompaction([userTextMessage('hello')])).toBeUndefined()
    expect(detectCompaction([])).toBeUndefined()
  })
})

// An upstream reword would silently disable compaction routing. Skipped when offline.
describe('copilot summarization prompt contract', () => {
  const SOURCE_URL = 'https://raw.githubusercontent.com/microsoft/vscode-copilot-chat/main/src/extension/prompts/node/agent/summarizedConversationHistory.tsx'

  it('still contains every phrase detection relies on', async ({ skip }) => {
    const response = await fetch(SOURCE_URL).catch(() => undefined)
    if (response === undefined || !response.ok) {
      skip()
      return
    }
    const source = await response.text()

    expect(source).toContain('Your task is to create a comprehensive, detailed summary of the entire conversation')
    expect(source).toContain('Summarize the conversation history so far')
    expect(source).toContain('The conversation has grown too large for the context window and must be compacted now.')
  })
})
