import type { ExtensionContext, OutputChannel } from 'vscode'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CacheMetricsTracker, formatUsageLine, normalizeUsage } from '../../src/chat/cache-metrics'
import { resetVSCodeMock, statusBarItem, vscodeMock } from '../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

describe('normalizeUsage', () => {
  it.each([
    [
      'Anthropic-native usage where input_tokens is the uncached remainder',
      { input_tokens: 300, cache_read_input_tokens: 700, cache_creation_input_tokens: 200, output_tokens: 50 },
      {
        shape: 'anthropic',
        inputTokens: 1200,
        cacheReadTokens: 700,
        cacheWriteTokens: 200,
        uncachedInputTokens: 300,
        outputTokens: 50,
        hitRate: 700 / 1200,
      },
    ],
    [
      'OpenAI Responses usage where input_tokens is the total',
      { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 40 },
      {
        shape: 'openai',
        inputTokens: 1000,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
        uncachedInputTokens: 200,
        outputTokens: 40,
        hitRate: 0.8,
      },
    ],
    [
      'Chat Completions field names',
      { prompt_tokens: 500, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens: 20 },
      {
        shape: 'openai',
        inputTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        uncachedInputTokens: 400,
        outputTokens: 20,
        hitRate: 0.2,
      },
    ],
    [
      'unknown shape with no cache fields',
      { output_tokens: 3 },
      {
        shape: 'unknown',
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        uncachedInputTokens: 0,
        outputTokens: 3,
        hitRate: undefined,
      },
    ],
  ] as const)('reads %s', (_name, usage, expected) => {
    expect(normalizeUsage(usage)).toEqual(expected)
  })

  it('tolerates a missing or non-object usage value', () => {
    expect(normalizeUsage(undefined).shape).toBe('unavailable')
    expect(normalizeUsage(undefined).outputTokens).toBe(0)
    expect(normalizeUsage('nonsense').shape).toBe('unavailable')
    expect(normalizeUsage({}).shape).toBe('unavailable')
  })
})

describe('formatUsageLine', () => {
  it('rounds the hit rate for a recognized shape', () => {
    const summary = normalizeUsage({
      input_tokens: 300,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 200,
      output_tokens: 50,
    })
    expect(formatUsageLine('claude', summary)).toBe(
      '[usage] claude: input=1200 cached=700 write=200 output=50 hit=58%',
    )
  })

  it('appends the raw object for an unrecognized shape so fields can be inspected', () => {
    const raw = { output_tokens: 3 }
    expect(formatUsageLine('model-a', normalizeUsage(raw), raw)).toBe(
      '[usage] model-a: input=0 cached=n/a write=0 output=3 hit=n/a raw={"output_tokens":3}',
    )
  })

  it('marks missing usage as unavailable', () => {
    expect(formatUsageLine('model-a', normalizeUsage(undefined))).toBe(
      '[usage] model-a: input=n/a cached=n/a write=n/a output=n/a hit=n/a (unavailable)',
    )
  })

  it('includes the reasoning effort sent to the proxy', () => {
    expect(formatUsageLine('model-a', normalizeUsage(undefined), undefined, 'xhigh')).toBe(
      '[usage] model-a: effort=xhigh input=n/a cached=n/a write=n/a output=n/a hit=n/a (unavailable)',
    )
  })
})

describe('cacheMetricsTracker', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ucp-cache-metrics-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function tracker(): CacheMetricsTracker {
    const context = { globalStorageUri: { fsPath: directory } } as unknown as ExtensionContext
    return new CacheMetricsTracker(context, vscodeMock.output as unknown as OutputChannel)
  }

  function record(metrics: CacheMetricsTracker, usage: unknown, context: Parameters<CacheMetricsTracker['start']>[0]): void {
    metrics.start(context)(usage)
  }

  interface Entry {
    model: string
    promptCacheKey?: string
    shape: string
    inputTokens: number
    cacheReadTokens: number
    hitRate: number | null
    inputPrefix: string[] | null
    crossTurn: {
      stablePrefixLen: number
      totalItems: number
      diverged: { index: number, before: string, after: string }[]
    } | null
  }

  async function entries(): Promise<Entry[]> {
    const lines = (await readFile(join(directory, 'debug.jsonl'), 'utf8')).trim().split('\n')
    return lines.map(line => JSON.parse(line) as Entry)
  }

  it('logs the summary but writes nothing and hides the status bar while disabled', async () => {
    const metrics = tracker()
    record(metrics, { output_tokens: 3 }, { model: 'model-a' })
    await metrics.flush()

    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      '[usage] model-a: input=0 cached=n/a write=0 output=3 hit=n/a raw={"output_tokens":3}',
    )
    expect(statusBarItem.show).not.toHaveBeenCalled()
    expect(statusBarItem.hide).toHaveBeenCalled()
    await expect(readFile(join(directory, 'debug.jsonl'), 'utf8')).rejects.toThrow()
  })

  it('records a JSONL line and a status-bar hit rate when enabled', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    record(metrics, {
      input_tokens: 300,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 0,
      output_tokens: 50,
    }, { model: 'claude-opus', promptCacheKey: 'session-1' })
    await metrics.flush()

    expect(statusBarItem.show).toHaveBeenCalled()
    expect(statusBarItem.text).toBe('$(database) 70% cached')

    const logged = await entries()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      model: 'claude-opus',
      promptCacheKey: 'session-1',
      shape: 'anthropic',
      inputTokens: 1000,
      cacheReadTokens: 700,
      hitRate: 0.7,
    })
  })

  it('excludes usage without cache details from the session hit rate', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    record(metrics, {
      input_tokens: 300,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 0,
    }, { model: 'claude-opus' })
    record(metrics, { input_tokens: 900, output_tokens: 50 }, { model: 'unknown-provider' })
    await metrics.flush()

    expect(statusBarItem.text).toBe('$(database) 70% cached')
    expect(statusBarItem.tooltip).toContain('cache read 700 · cache write 0 · uncached 300')
  })

  it('shows an unavailable session hit rate until cache details are received', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    record(metrics, { input_tokens: 900, output_tokens: 50 }, { model: 'unknown-provider' })
    await metrics.flush()

    expect(statusBarItem.text).toBe('$(database) n/a cached')
  })

  it('counts unavailable requests without adding them to usage totals', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    record(metrics, undefined, { model: 'codex' })
    record(metrics, {
      input_tokens: 300,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 0,
      output_tokens: 50,
    }, { model: 'claude' })
    await metrics.flush()

    expect(statusBarItem.text).toBe('$(database) 70% cached')
    expect(statusBarItem.tooltip).toContain('cache read 700 · cache write 0 · uncached 300 · output 50')
    expect(statusBarItem.tooltip).toContain('2 requests, 1 with usage')
  })

  it('fingerprints the request prefix so a stable lead and a divergent tail are distinguishable', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    const system = { role: 'system', content: 'you are a helper' }
    record(metrics, { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }, {
      model: 'm',
      promptCacheKey: 'session-1',
      inputItems: [system, { role: 'user', content: 'first' }],
    })
    record(metrics, { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }, {
      model: 'm',
      promptCacheKey: 'session-1',
      inputItems: [system, { role: 'user', content: 'second' }],
    })
    await metrics.flush()

    const logged = await entries()
    const first = logged[0]!
    const second = logged[1]!
    expect(first.inputPrefix![0]).toBe(second.inputPrefix![0]) // identical system message → identical fingerprint (cacheable prefix)
    expect(first.inputPrefix![1]).not.toBe(second.inputPrefix![1]) // different user turn → divergent fingerprint

    expect(second.crossTurn!.stablePrefixLen).toBe(1)
    expect(second.crossTurn!.diverged[0]!.index).toBe(1)
    expect(second.crossTurn!.diverged[0]!.before).toContain('first')
    expect(second.crossTurn!.diverged[0]!.after).toContain('second')
    expect(first.crossTurn).toBeNull() // first turn has no predecessor
  })

  it('windows a divergence on the change, not the start, so a long shared head does not hide it', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    const head = 'x'.repeat(20_000)
    record(metrics, { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }, {
      model: 'm',
      promptCacheKey: 'session-1',
      inputItems: [{ role: 'user', content: `${head}BEFORE_MARKER` }],
    })
    record(metrics, { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }, {
      model: 'm',
      promptCacheKey: 'session-1',
      inputItems: [{ role: 'user', content: `${head}AFTER_MARKER` }],
    })
    await metrics.flush()

    const logged = await entries()
    const { before, after } = logged[1]!.crossTurn!.diverged[0]!
    expect(before).toContain('BEFORE_MARKER')
    expect(after).toContain('AFTER_MARKER')
    expect(before).toMatch(/^…\(\+\d+\)/)
    expect(before.length).toBeLessThan(head.length)
  })

  it('isolates prefix comparisons by prompt cache key', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    const usage = { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }
    const systemA = { role: 'system', content: 'session a' }
    const systemB = { role: 'system', content: 'session b' }

    record(metrics, usage, { model: 'm', promptCacheKey: 'a', inputItems: [systemA] })
    record(metrics, usage, { model: 'm', promptCacheKey: 'b', inputItems: [systemB] })
    record(metrics, usage, { model: 'm', promptCacheKey: 'a', inputItems: [systemA, { role: 'user', content: 'next' }] })
    await metrics.flush()

    const logged = await entries()
    expect(logged[0]!.crossTurn).toBeNull()
    expect(logged[1]!.crossTurn).toBeNull()
    expect(logged[2]!.crossTurn).toMatchObject({ stablePrefixLen: 1, totalItems: 2 })
  })

  it('keeps invocation order when same-key requests complete in reverse order', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    const usage = { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }
    const system = { role: 'system', content: 'stable' }
    const first = metrics.start({ model: 'm', promptCacheKey: 'session-1', inputItems: [system] })
    const second = metrics.start({ model: 'm', promptCacheKey: 'session-1', inputItems: [system, { role: 'user', content: 'next' }] })

    second(usage)
    first(usage)
    await metrics.flush()

    const logged = await entries()
    expect(logged[0]!.crossTurn).toMatchObject({ stablePrefixLen: 1, totalItems: 2 })
    expect(logged[1]!.crossTurn).toBeNull()
  })

  it('does not compare requests without a prompt cache key', async () => {
    vscodeMock.settings.set('universalChatProvider.debug', true)
    const metrics = tracker()
    const usage = { input_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } }

    record(metrics, usage, { model: 'm', inputItems: [{ role: 'system', content: 'first' }] })
    record(metrics, usage, { model: 'm', inputItems: [{ role: 'system', content: 'second' }] })
    await metrics.flush()

    const logged = await entries()
    expect(logged.map(entry => entry.crossTurn)).toEqual([null, null])
  })
})
