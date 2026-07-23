import { buildOpenAICompatibilityProvider } from '@src/cliproxy/accounts/openai-compat-endpoint'
import { describe, expect, it } from 'vitest'

describe('openai-compatible endpoint provider', () => {
  it('builds an enriched provider with a case-insensitive unique hostname', () => {
    const provider = buildOpenAICompatibilityProvider({
      baseUrl: 'https://www.CodeGate.dev/v1',
      apiKey: 'sk-test',
      modelIds: ['gpt-5.5', 'custom-model'],
      catalog: new Map([
        ['gpt-5.5', {
          id: 'gpt-5.5',
          thinking: { levels: ['low', 'medium', 'high'] },
        }],
      ]),
    }, [
      { 'name': 'codegate.dev', 'base-url': 'https://codegate.dev/v1' },
      { 'name': 'CODEGATE.DEV-2', 'base-url': 'https://codegate.dev/v1' },
    ])

    expect(provider).toEqual({
      'name': 'codegate.dev-3',
      'base-url': 'https://www.CodeGate.dev/v1',
      'api-key-entries': [{ 'api-key': 'sk-test' }],
      'models': [
        {
          name: 'gpt-5.5',
          alias: 'codegate.dev-3/gpt-5.5',
          thinking: { levels: ['low', 'medium', 'high'] },
        },
        { name: 'custom-model', alias: 'codegate.dev-3/custom-model' },
      ],
    })
  })
})
