import type { CatalogModel } from '../../../src/chat/models/catalog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchCatalogModel } from '../../../src/chat/models/catalog-match'

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
    const { fetchCatalog } = await import('../../../src/chat/models/catalog')

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
    const { fetchCatalog } = await import('../../../src/chat/models/catalog')

    await expect(fetchCatalog()).resolves.toEqual(new Map())
  })

  it('returns an empty catalog on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { fetchCatalog } = await import('../../../src/chat/models/catalog')

    await expect(fetchCatalog()).resolves.toEqual(new Map())
  })
})

describe('flattenCatalog', () => {
  it('prefers richer duplicate metadata', async () => {
    const { flattenCatalog } = await import('../../../src/chat/models/catalog')

    const catalog = flattenCatalog({
      openai: [{ id: 'shared', context_length: 128_000 }],
      aliases: [{ id: 'shared', context_length: 128_000, thinking: { levels: ['low', 'high'] } }],
    })

    expect(catalog.get('shared')?.thinking?.levels).toEqual(['low', 'high'])
  })

  it('ignores malformed catalog sections', async () => {
    const { flattenCatalog } = await import('../../../src/chat/models/catalog')

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
