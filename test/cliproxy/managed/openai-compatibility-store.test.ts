import { OpenAICompatibilityStore } from '@src/cliproxy/managed/openai-compatibility-store'
import { describe, expect, it } from 'vitest'
import { createExtensionContext } from '../../support/vscode'

describe('openai compatibility store', () => {
  it('round-trips complete provider configuration', async () => {
    const secrets = createExtensionContext().secrets
    const store = new OpenAICompatibilityStore(secrets)
    const providers = [{
      'name': 'openrouter.ai',
      'base-url': 'https://openrouter.ai/api/v1',
      'api-key-entries': [{ 'api-key': 'sk-or' }],
      'models': [{ name: 'gpt-5.5', alias: 'openrouter.ai/gpt-5.5', thinking: { levels: ['high'] } }],
    }]

    await store.set(providers)

    await expect(store.get()).resolves.toEqual(providers)
  })

  it('treats missing or invalid data as empty', async () => {
    const secrets = new Map<string, string>([['universalChatProvider.openAICompatibility', '{bad']])
    const store = new OpenAICompatibilityStore(createExtensionContext({ secrets }).secrets)

    await expect(store.get()).resolves.toEqual([])
  })
})
