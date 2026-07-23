import { describe, expect, it } from 'vitest'
import { enrichOpenAICompatibilityProviders } from '../../../src/cliproxy/accounts/openai-compat-thinking'

const catalog = new Map([
  ['gpt-5.6-sol', {
    id: 'gpt-5.6-sol',
    thinking: { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  }],
  ['gpt-5.5', {
    id: 'gpt-5.5',
    thinking: { levels: ['Low', 'MEDIUM', 'high', 'xhigh'] },
  }],
  ['mystery', {
    id: 'mystery',
    thinking: { max: 32_768 },
  }],
])

describe('openai-compat thinking enrichment', () => {
  it('enriches only models missing thinking levels', () => {
    const providers = [
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-test' }],
        'models': [
          { name: 'gpt-5.6-sol', alias: 'codegate.dev/gpt-5.6-sol' },
          {
            name: 'gpt-5.5',
            alias: 'codegate.dev/gpt-5.5',
            thinking: { levels: ['low', 'high'] },
          },
          { name: 'mystery', alias: 'codegate.dev/mystery' },
        ],
      },
    ]

    expect(enrichOpenAICompatibilityProviders(providers, catalog)).toBe(true)
    expect(providers).toEqual([
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-test' }],
        'models': [
          {
            name: 'gpt-5.6-sol',
            alias: 'codegate.dev/gpt-5.6-sol',
            thinking: { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
          },
          {
            name: 'gpt-5.5',
            alias: 'codegate.dev/gpt-5.5',
            thinking: { levels: ['low', 'high'] },
          },
          { name: 'mystery', alias: 'codegate.dev/mystery' },
        ],
      },
    ])
    expect(enrichOpenAICompatibilityProviders(providers, catalog)).toBe(false)
  })
})
