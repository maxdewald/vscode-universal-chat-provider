import type { LanguageModelChatRequestMessage } from 'vscode'
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode'

// Copilot never flags a request as a compaction, so it is recognised by prompt text copied from
// vscode-copilot-chat `src/extension/prompts/node/agent/summarizedConversationHistory.tsx`.
// A contract test checks these against the current upstream file.
const SUMMARY_PROMPT_OPENER = 'Your task is to create a comprehensive, detailed summary of the entire conversation'
const SEPARATE_REQUEST_OPENER = 'Summarize the conversation history so far'
const INLINE_REQUEST_MARKER = 'The conversation has grown too large for the context window and must be compacted now.'

// The published enum does not name Copilot's system role.
const SYSTEM_ROLE = 3
const USER_ROLE: number = LanguageModelChatMessageRole.User

// `separate` is a standalone call whose reply is only stored as a summary, so it may run on
// another model. `inline` continues the current turn and must stay on the requested model.
export function detectCompaction(
  messages: readonly LanguageModelChatRequestMessage[],
): 'separate' | 'inline' | undefined {
  let hasSummaryPrompt = false

  for (const message of messages) {
    const role: number = message.role
    const text = messageText(message)
    if (role === SYSTEM_ROLE && text.includes(SUMMARY_PROMPT_OPENER))
      hasSummaryPrompt = true
    else if (role === USER_ROLE && text.includes(INLINE_REQUEST_MARKER))
      return 'inline'
  }

  if (!hasSummaryPrompt)
    return undefined
  const lastUser = messages.findLast(message => message.role === USER_ROLE)
  return lastUser !== undefined && messageText(lastUser).includes(SEPARATE_REQUEST_OPENER)
    ? 'separate'
    : undefined
}

function messageText(message: LanguageModelChatRequestMessage): string {
  return message.content
    .filter(part => part instanceof LanguageModelTextPart)
    .map(part => part.value)
    .join('\n')
}
