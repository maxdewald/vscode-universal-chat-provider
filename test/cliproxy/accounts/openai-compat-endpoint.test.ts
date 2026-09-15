import { buildOpenAICompatibilityProvider, withSessionHeaderDefaults } from '@src/cliproxy/accounts/openai-compat-endpoint'
import { describe, expect, it } from 'vitest'

describe('openai-compatible endpoint provider', () => {
  it.each([
    ['https://opencode.ai/zen/v1', 'x-opencode-session'],
    ['https://OPENCODE.AI/zen/go/v1/', 'x-opencode-session'],
    ['https://openrouter.ai/api/v1', 'x-session-id'],
  ])('adds a dynamic session header for %s', (baseUrl, header) => {
    const provider = buildOpenAICompatibilityProvider({ baseUrl, apiKey: 'test', modelIds: ['model'] }, [])
    expect(provider.headers).toEqual({ [header]: '$CPA-SESSION-ID' })
    expect(withSessionHeaderDefaults(provider)).toBe(provider)
  })

  it.each([
    'https://example.com/v1',
    'https://opencode.ai.example.com/v1',
    'https://sub.openrouter.ai/v1',
    'https://example.com/openrouter.ai',
    'not a URL',
    'ftp://opencode.ai/v1',
  ])('leaves unrelated or invalid endpoints unchanged: %s', (baseUrl) => {
    const provider = { 'name': 'opencode.ai', 'base-url': baseUrl }
    expect(withSessionHeaderDefaults(provider)).toBe(provider)
  })

  it.each([
    ['opencode.ai', 'X-OpenCode-Session'],
    ['openrouter.ai', 'X-Session-ID'],
  ])('preserves explicit header overrides for %s', (hostname, header) => {
    for (const value of ['custom-session', '', '$X-Session-ID']) {
      const provider = { 'name': 'custom', 'base-url': `https://${hostname}/v1`, 'headers': { [header]: value } }
      expect(withSessionHeaderDefaults(provider)).toBe(provider)
    }
  })

  it('preserves unrelated headers without mutating stored providers', () => {
    const provider = { 'name': 'custom', 'base-url': 'https://openrouter.ai/api/v1', 'headers': { 'X-Custom': 'value' } }
    expect(withSessionHeaderDefaults(provider).headers).toEqual({
      'X-Custom': 'value',
      'x-session-id': '$CPA-SESSION-ID',
    })
    expect(provider.headers).toEqual({ 'X-Custom': 'value' })
  })

  it('builds a provider with a case-insensitive unique hostname', () => {
    const provider = buildOpenAICompatibilityProvider({
      baseUrl: 'https://www.CodeGate.dev/v1',
      apiKey: 'sk-test',
      modelIds: ['gpt-5.5', 'custom-model'],
    }, [
      { 'name': 'codegate.dev', 'base-url': 'https://codegate.dev/v1' },
      { 'name': 'CODEGATE.DEV-2', 'base-url': 'https://codegate.dev/v1' },
    ])

    expect(provider).toEqual({
      'name': 'codegate.dev-3',
      'base-url': 'https://www.CodeGate.dev/v1',
      'api-key-entries': [{ 'api-key': 'sk-test' }],
      'models': [
        { name: 'gpt-5.5', alias: 'codegate.dev-3/gpt-5.5' },
        { name: 'custom-model', alias: 'codegate.dev-3/custom-model' },
      ],
    })
  })
})
