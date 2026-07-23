import type { LanguageModelChatMessage } from 'vscode'
import type { ProviderModel } from '../../src/chat/models/model'
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode'

export function createProviderModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: 'model-a',
    proxyModelId: 'model-a',
    proxyOwner: 'openai',
    name: 'Model A',
    family: 'test',
    version: '1',
    maxInputTokens: 100,
    maxOutputTokens: 20,
    reasoningLevels: ['low', 'high'],
    supportsParallelToolCalls: true,
    capabilities: {
      imageInput: false,
      toolCalling: true,
    },
    ...overrides,
  }
}

export function userTextMessage(text: string): LanguageModelChatMessage {
  return {
    role: LanguageModelChatMessageRole.User,
    content: [new LanguageModelTextPart(text)],
    name: undefined,
  }
}

export function singleModelDiscovery(overrides: Record<string, unknown> = {}): {
  available: Array<Record<string, unknown> & {
    id: string
    owned_by: string
    context_length: number
    max_completion_tokens: number
  }>
  metadata: never[]
} {
  return {
    available: [{
      id: 'model-a',
      owned_by: 'test',
      context_length: 128_000,
      max_completion_tokens: 20,
      ...overrides,
    }],
    metadata: [],
  }
}

export function decodeJsonDataPart(part: { data: Uint8Array }): unknown {
  return JSON.parse(new TextDecoder().decode(part.data))
}
