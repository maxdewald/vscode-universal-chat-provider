import type {
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode'
import type { ProviderModel } from './model'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from 'vscode'

export type ReasoningSummary = 'auto' | 'concise' | 'detailed'

export function buildRequest(
  model: ProviderModel,
  messages: readonly LanguageModelChatRequestMessage[],
  options: ProvideLanguageModelChatResponseOptions,
  reasoningEffort?: string,
  reasoningSummary: ReasoningSummary = 'detailed',
): Record<string, unknown> {
  const promptCacheKey = buildPromptCacheKey(model, messages)
  const request: Record<string, unknown> = {
    model: model.proxyModelId,
    input: messages.flatMap(convertMessage),
    stream: true,
    max_output_tokens: model.maxOutputTokens,
    ...(promptCacheKey !== undefined ? { prompt_cache_key: promptCacheKey } : {}),
  }

  const effort = reasoningEffort !== undefined && model.reasoningLevels.includes(reasoningEffort)
    ? reasoningEffort
    : model.reasoningEffort ?? model.reasoningLevels[0]
  if (effort !== undefined)
    request.reasoning = { effort, summary: reasoningSummary }

  if (options.tools !== undefined && options.tools.length > 0) {
    request.tools = options.tools.map((tool) => {
      const parameters = tool.inputSchema ?? { type: 'object', properties: {} }
      return {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters,
        strict: false,
      }
    })
    request.tool_choice = options.toolMode === LanguageModelChatToolMode.Required ? 'required' : 'auto'
    request.parallel_tool_calls = model.supportsParallelToolCalls
  }

  return request
}

export function buildPromptCacheKey(
  model: ProviderModel,
  messages: readonly LanguageModelChatRequestMessage[],
): string | undefined {
  const seed = sessionSeed(messages)
  if (seed === undefined)
    return undefined

  const hash = createHash('sha256')
    .update('universal-chat-provider:prompt-cache:v1\0')
    .update(model.proxyModelId)
    .update('\0')
    .update(seed)
    .digest('hex')
    .slice(0, 32)
  return `universal-chat-provider-${hash}`
}

function isCacheControlPart(part: unknown): boolean {
  return part instanceof LanguageModelDataPart && part.mimeType === 'cache_control'
}

export function convertMessage(message: LanguageModelChatRequestMessage): Record<string, unknown>[] {
  const messageRole: number = message.role
  const role = messageRole === LanguageModelChatMessageRole.Assistant
    ? 'assistant'
    : messageRole === 3 ? 'system' : 'user'
  const content: Record<string, unknown>[] = []
  const items: Record<string, unknown>[] = []

  for (const part of message.content) {
    if (isCacheControlPart(part))
      continue
    if (part instanceof LanguageModelTextPart) {
      content.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: part.value,
      })
    }
    else if (part instanceof LanguageModelDataPart) {
      if (part.mimeType.startsWith('image/')) {
        content.push({
          type: 'input_image',
          image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
        })
      }
      else {
        content.push({
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text: new TextDecoder().decode(part.data),
        })
      }
    }
    else if (part instanceof LanguageModelToolCallPart) {
      items.push({
        type: 'function_call',
        call_id: part.callId,
        name: part.name,
        arguments: JSON.stringify(part.input),
      })
    }
    else if (part instanceof LanguageModelToolResultPart) {
      items.push({
        type: 'function_call_output',
        call_id: part.callId,
        output: serializeToolResult(part),
      })
    }
  }

  if (content.length)
    items.unshift({ role, content })
  return items
}

export function serializeToolResult(part: LanguageModelToolResultPart): string {
  return part.content.filter(value => !isCacheControlPart(value)).map((value) => {
    if (value instanceof LanguageModelTextPart)
      return value.value
    if (value instanceof LanguageModelDataPart) {
      return value.mimeType.startsWith('text/')
        ? new TextDecoder().decode(value.data)
        : `[${value.mimeType} data]`
    }
    return JSON.stringify(value)
  }).join('\n')
}

function sessionSeed(messages: readonly LanguageModelChatRequestMessage[]): string | undefined {
  const leadingUserMessages: string[] = []
  for (const message of messages) {
    if (message.role === LanguageModelChatMessageRole.Assistant)
      break

    const fingerprint = messageFingerprint(message)
    if (fingerprint !== undefined)
      leadingUserMessages.push(fingerprint)
  }

  if (leadingUserMessages.length > 0)
    return leadingUserMessages.join('\n---\n')

  const first = messages.find(message => message.role !== LanguageModelChatMessageRole.Assistant)
  return first !== undefined ? messageFingerprint(first) : undefined
}

function messageFingerprint(message: LanguageModelChatRequestMessage): string | undefined {
  const parts = message.content.map(partFingerprint).filter(value => value !== undefined)
  if (parts.length === 0)
    return undefined
  return `${message.role}:${parts.join('\n')}`
}

function partFingerprint(part: LanguageModelChatRequestMessage['content'][number]): string | undefined {
  if (isCacheControlPart(part))
    return undefined
  if (part instanceof LanguageModelTextPart)
    return `text:${part.value}`
  if (part instanceof LanguageModelDataPart) {
    if (part.mimeType.startsWith('text/'))
      return `data:${part.mimeType}:${new TextDecoder().decode(part.data)}`
    return `data:${part.mimeType}:${createHash('sha256').update(part.data).digest('hex')}`
  }
  if (part instanceof LanguageModelToolResultPart)
    return `tool-result:${part.callId}:${serializeToolResult(part)}`
  if (part instanceof LanguageModelToolCallPart)
    return `tool-call:${part.callId}:${part.name}:${JSON.stringify(part.input)}`
  return undefined
}
