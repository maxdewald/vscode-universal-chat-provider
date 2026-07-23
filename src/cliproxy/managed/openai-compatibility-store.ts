import type { OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import type { SecretStorage } from 'vscode'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'

export const OPENAI_COMPATIBILITY_SECRET = 'universalChatProvider.openAICompatibility'

const ProviderSchema = Type.Object({
  'name': Type.String(),
  'base-url': Type.String(),
}, { additionalProperties: true })

const ProvidersSchema = Type.Array(ProviderSchema)

export class OpenAICompatibilityStore {
  constructor(private readonly secrets: SecretStorage) {}

  async get(): Promise<OpenAICompatibilityProvider[]> {
    const stored = await this.secrets.get(OPENAI_COMPATIBILITY_SECRET)
    if (stored === undefined)
      return []
    try {
      return asValue(ProvidersSchema, JSON.parse(stored)) ?? []
    }
    catch {
      return []
    }
  }

  async set(providers: OpenAICompatibilityProvider[]): Promise<void> {
    await this.secrets.store(OPENAI_COMPATIBILITY_SECRET, JSON.stringify(providers))
  }
}
