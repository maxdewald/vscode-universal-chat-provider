import type { CatalogModel } from '../../src/chat/catalog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchCatalogModel } from '../../src/chat/catalog-match'
import { mapProxyModels } from '../../src/chat/model'

const catalogUrl = 'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json'

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
  it('fetches, flattens, and caches the catalog for the session', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ provider: [{ id: 'model-a', context_length: 10 }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('../../src/chat/catalog')

    const first = await fetchCatalog()
    const second = await fetchCatalog()

    expect(first.get('model-a')?.context_length).toBe(10)
    expect(second).toBe(first)
    expect(fetchMock.mock.calls.filter(([url]) => url === catalogUrl)).toHaveLength(1)
  })

  it('returns an empty catalog when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const { fetchCatalog } = await import('../../src/chat/catalog')

    await expect(fetchCatalog()).resolves.toEqual(new Map())
  })

  it('returns an empty catalog on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { fetchCatalog } = await import('../../src/chat/catalog')

    await expect(fetchCatalog()).resolves.toEqual(new Map())
  })
})

describe('flattenCatalog', () => {
  it('prefers richer duplicate metadata', async () => {
    const { flattenCatalog } = await import('../../src/chat/catalog')

    const catalog = flattenCatalog({
      openai: [{ id: 'shared', context_length: 128_000 }],
      aliases: [{ id: 'shared', context_length: 128_000, thinking: { levels: ['low', 'high'] } }],
    })

    expect(catalog.get('shared')?.thinking?.levels).toEqual(['low', 'high'])
  })

  it('ignores malformed catalog sections', async () => {
    const { flattenCatalog } = await import('../../src/chat/catalog')

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

describe('catalog model mapping', () => {
  it('matches catalog limits by stripped vendor prefix, colon variants, and dotted versions', () => {
    const catalog = new Map([
      ['gpt-5.5', {
        id: 'gpt-5.5',
        display_name: 'GPT-5.5',
        context_length: 400_000,
        max_completion_tokens: 128_000,
      }],
      ['claude-opus-4-8', {
        id: 'claude-opus-4-8',
        display_name: 'Claude Opus 4.8',
        context_length: 200_000,
        max_completion_tokens: 64_000,
      }],
    ])

    const models = mapProxyModels(
      [
        { id: 'openai/gpt-5.5:free', owned_by: 'openrouter.ai' },
        { id: 'anthropic/claude-opus-4.8', owned_by: 'openrouter.ai' },
        { id: 'anthropic/claude-opus-4.8:thinking', owned_by: 'openrouter.ai' },
      ],
      [],
      catalog,
      {},
    )

    // Same base display name collides → full ids; still inherit catalog limits.
    expect(models.map(model => [model.id, model.name, model.maxInputTokens])).toEqual([
      ['anthropic/claude-opus-4.8', 'anthropic/claude-opus-4.8', 200_000],
      ['anthropic/claude-opus-4.8:thinking', 'anthropic/claude-opus-4.8:thinking', 200_000],
      ['openai/gpt-5.5:free', 'GPT-5.5', 400_000],
    ])
  })

  it('matches New API-style catalog variants for limits and display names', () => {
    const models = mapProxyModels(
      [
        { id: 'gpt-5.5-openai-compact', owned_by: 'codegate.dev' },
        { id: 'claude-opus-4-8-thinking', owned_by: 'codegate.dev' },
        { id: 'claude-opus-4-8-high', owned_by: 'codegate.dev' },
        { id: 'gemini-3.5-flash-nothinking', owned_by: 'codegate.dev' },
      ],
      [
        { slug: 'gpt-5.5-openai-compact', display_name: 'gpt-5.5-openai-compact' },
      ],
      new Map([
        ['gpt-5.5', {
          id: 'gpt-5.5',
          display_name: 'GPT-5.5',
          context_length: 272_000,
          max_completion_tokens: 128_000,
        }],
        ['claude-opus-4-8', {
          id: 'claude-opus-4-8',
          display_name: 'Claude Opus 4.8',
          context_length: 200_000,
          max_completion_tokens: 64_000,
        }],
        ['gemini-3.5-flash', {
          id: 'gemini-3.5-flash',
          display_name: 'Gemini 3.5 Flash',
          context_length: 1_000_000,
          max_completion_tokens: 65_536,
        }],
      ]),
      {},
    )

    expect(models.map(model => [model.id, model.name, model.maxInputTokens])).toEqual([
      ['claude-opus-4-8-high', 'claude-opus-4-8-high', 200_000],
      ['claude-opus-4-8-thinking', 'claude-opus-4-8-thinking', 200_000],
      ['gemini-3.5-flash-nothinking', 'Gemini 3.5 Flash', 1_000_000],
      ['gpt-5.5-openai-compact', 'GPT-5.5', 272_000],
    ])
  })

  it('derives reasoning levels and capability fallbacks from the catalog', () => {
    const models = mapProxyModels(
      [{ id: 'vendor/model' }],
      [],
      new Map([['vendor/model', {
        id: 'vendor/model',
        type: 'vendor',
        display_name: 'Catalog Model',
        version: 'v1',
        inputTokenLimit: 1_000_000,
        outputTokenLimit: 50_000,
        supportedInputModalities: ['TEXT', 'IMAGE'],
        supported_parameters: [],
        thinking: {
          zero_allowed: true,
          dynamic_allowed: true,
          max: 10,
        },
      }]]),
      {},
    )

    const model = models[0]
    expect(models).toHaveLength(1)
    expect(model).toMatchObject({
      name: 'Catalog Model',
      family: 'vendor/model',
      version: 'v1',
      maxInputTokens: 1_000_000,
      maxOutputTokens: 50_000,
      reasoningLevels: ['none', 'low', 'medium', 'high', 'auto'],
      reasoningEffort: 'high',
      detail: '1M context · Vendor',
      capabilities: {
        imageInput: true,
        toolCalling: false,
      },
    })
  })
})
