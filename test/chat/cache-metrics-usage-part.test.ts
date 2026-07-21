import { describe, expect, it } from 'vitest'
import { LanguageModelDataPart } from 'vscode'
import { createContextUsagePart } from '../../src/chat/cache-metrics'

describe('createContextUsagePart', () => {
  it('returns nothing when usage is unavailable', () => {
    expect(createContextUsagePart(undefined)).toBeUndefined()
    expect(createContextUsagePart({})).toBeUndefined()
  })

  it('omits cache details when the provider does not report them', () => {
    const part = createContextUsagePart({ input_tokens: 100, output_tokens: 10 })

    expect(JSON.parse(new TextDecoder().decode(part?.data))).toEqual({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
    })
  })

  it.each([
    [
      'Anthropic',
      { input_tokens: 300, cache_read_input_tokens: 700, cache_creation_input_tokens: 0, output_tokens: 50 },
      { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 700 } },
    ],
    [
      'OpenAI',
      { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 40 },
      { prompt_tokens: 1000, completion_tokens: 40, total_tokens: 1040, prompt_tokens_details: { cached_tokens: 800 } },
    ],
  ])('normalizes %s usage', (_name, usage, expected) => {
    const part = createContextUsagePart(usage)

    expect(part).toBeInstanceOf(LanguageModelDataPart)
    expect(part?.mimeType).toBe('usage')
    expect(JSON.parse(new TextDecoder().decode(part?.data))).toEqual(expected)
  })
})
