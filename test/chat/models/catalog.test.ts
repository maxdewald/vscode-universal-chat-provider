import type { CatalogModel } from '@src/chat/models/catalog'
import { matchCatalogModel } from '@src/chat/models/catalog-match'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const catalogUrl = 'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json'
const modelsDevUrl = 'https://models.dev/catalog.json'

function catalog(...ids: string[]): Map<string, CatalogModel> {
  return new Map(ids.map(id => [id, {
    id,
    context_length: 128_000,
    max_completion_tokens: 8192,
  }]))
}

beforeEach(() => {
  vi.resetModules()
})

describe('fetchCatalog', () => {
  it('keeps router and models.dev metadata separate', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === catalogUrl) {
        return Response.json({
          provider: [{ id: 'deepseek-v4-flash', display_name: 'Router DeepSeek', context_length: 272_000 }],
        })
      }
      if (url === modelsDevUrl) {
        return Response.json({
          providers: {
            opencode: {
              id: 'opencode',
              api: 'https://opencode.ai/zen/v1',
              models: {
                'deepseek-v4-flash': {
                  id: 'deepseek-v4-flash',
                  name: 'DeepSeek V4 Flash (New)',
                  description: 'Provider model',
                  tool_call: true,
                  modalities: { input: ['text'], output: ['text'] },
                  limit: { context: 1_000_000, output: 384_000 },
                },
                'grok-4.5': {
                  id: 'grok-4.5',
                  name: 'Grok 4.5',
                  limit: { context: 500_000, output: 500_000 },
                },
              },
            },
            sarvam: {
              id: 'sarvam',
              models: {
                'sarvam-30b': {
                  id: 'sarvam-30b',
                  reasoning_options: [{ values: [null, 'low', 'high'] }],
                },
              },
            },
          },
          models: {
            'deepseek/deepseek-v4-flash': {
              id: 'deepseek/deepseek-v4-flash',
              name: 'Generic DeepSeek',
              description: 'Canonical model',
              tool_call: true,
              modalities: { input: ['text'], output: ['text'] },
              limit: { context: 1_000_000, output: 384_000 },
            },
          },
        })
      }
      return new Response(null, { status: 404 })
    }))
    const { fetchCatalog } = await import('@src/chat/models/catalog')

    const result = await fetchCatalog()

    expect(result.router.get('deepseek-v4-flash')).toMatchObject({
      display_name: 'Router DeepSeek',
      context_length: 272_000,
    })
    expect(result.modelsDev.get('opencode.ai/deepseek-v4-flash')).toMatchObject({
      display_name: 'DeepSeek V4 Flash (New)',
      context_length: 616_000,
      max_completion_tokens: 384_000,
      supportedInputModalities: ['text'],
      supported_parameters: ['tools'],
    })
    expect(matchCatalogModel('custom.example/deepseek-v4-flash', result.modelsDev)).toMatchObject({
      display_name: 'Generic DeepSeek',
      context_length: 616_000,
      max_completion_tokens: 384_000,
    })
    expect(result.modelsDev.get('opencode.ai/grok-4.5')).toMatchObject({
      context_length: 500_000,
      max_completion_tokens: 500_000,
    })
  })

  it('fetches, flattens, and caches the catalog for the session', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({ provider: [{ id: 'model-a', context_length: 10 }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('@src/chat/models/catalog')

    const first = await fetchCatalog()
    const second = await fetchCatalog()

    expect(first.router.get('model-a')?.context_length).toBe(10)
    expect(second).toBe(first)
    expect(fetchMock.mock.calls.filter(([input]) => input instanceof Request && input.url === catalogUrl)).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => input instanceof Request && input.url === modelsDevUrl)).toHaveLength(1)
  })

  it('returns an empty catalog when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const { fetchCatalog } = await import('@src/chat/models/catalog')

    await expect(fetchCatalog()).resolves.toEqual({ router: new Map(), modelsDev: new Map() })
  })

  it('returns an empty catalog on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { fetchCatalog } = await import('@src/chat/models/catalog')

    await expect(fetchCatalog()).resolves.toEqual({ router: new Map(), modelsDev: new Map() })
  })
})

describe('flattenCatalog', () => {
  it('prefers richer duplicate metadata', async () => {
    const { flattenCatalog } = await import('@src/chat/models/catalog')

    const catalog = flattenCatalog({
      openai: [{ id: 'shared', context_length: 128_000 }],
      aliases: [{ id: 'shared', context_length: 128_000, thinking: { levels: ['low', 'high'] } }],
    })

    expect(catalog.get('shared')?.thinking?.levels).toEqual(['low', 'high'])
  })

  it('ignores malformed catalog sections', async () => {
    const { flattenCatalog } = await import('@src/chat/models/catalog')

    expect(flattenCatalog(null)).toEqual(new Map())
    expect(flattenCatalog({
      invalid: 'not an array',
      entries: [null, {}, { id: 1 }, { id: 'valid', outputTokenLimit: 20 }],
    })).toEqual(new Map([['valid', { id: 'valid', outputTokenLimit: 20 }]]))
  })
})

describe('matchCatalogModel', () => {
  it('matches exact, vendor-prefixed, colon, dotted, and New API suffix ids', () => {
    const models = catalog('gpt-5.5', 'claude-opus-4-8', 'gemini-3.5-flash')

    expect(matchCatalogModel('gpt-5.5', models)?.id).toBe('gpt-5.5')
    expect(matchCatalogModel('openai/gpt-5.5:free', models)?.id).toBe('gpt-5.5')
    expect(matchCatalogModel('anthropic/claude-opus-4.8', models)?.id).toBe('claude-opus-4-8')
    expect(matchCatalogModel('anthropic/claude-opus-4.8:thinking', models)?.id).toBe('claude-opus-4-8')
    expect(matchCatalogModel('claude-opus-4-8-thinking', models)?.id).toBe('claude-opus-4-8')
    expect(matchCatalogModel('gemini-3.5-flash-nothinking', models)?.id).toBe('gemini-3.5-flash')
    expect(matchCatalogModel('gpt-5.5-openai-compact', models)?.id).toBe('gpt-5.5')
  })

  it('prefers exact catalog ids over suffix-stripped bases', () => {
    const models = catalog('claude-opus-4-6', 'claude-opus-4-6-thinking')
    expect(matchCatalogModel('claude-opus-4-6-thinking', models)?.id).toBe('claude-opus-4-6-thinking')
  })

  it('does not treat longer model revisions as variants', () => {
    expect(matchCatalogModel('claude-sonnet-4-5-thinking', catalog('claude-sonnet-4'))).toBeUndefined()
  })
})
