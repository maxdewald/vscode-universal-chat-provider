import type { ExtensionContext, OutputChannel, StatusBarItem } from 'vscode'
import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Type } from '@sinclair/typebox'
import { LanguageModelDataPart, StatusBarAlignment, window, workspace } from 'vscode'
import { errorMessage } from '../shared/errors'
import { asValue } from '../shared/json'

const ENABLED_SETTING = 'debug'
const LOG_FILE = 'debug.jsonl'
const DIVERGED_CONTENT_CAP = 6000
const DIVERGED_CONTENT_LEAD = 200

type UsageShape = 'anthropic' | 'openai' | 'unknown' | 'unavailable'

export interface UsageSummary {
  shape: UsageShape
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  uncachedInputTokens: number
  outputTokens: number
  hitRate: number | undefined
}

interface UsageContext {
  model: string
  promptCacheKey?: string | undefined
  reasoningEffort?: string | undefined
  inputItems?: readonly unknown[] | undefined
}

const FingerprintItemSchema = Type.Object({
  role: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
})

function fingerprintInput(items: readonly unknown[] | undefined): string[] | undefined {
  return items?.map((item) => {
    const json = JSON.stringify(item) ?? ''
    const record = asValue(FingerprintItemSchema, item)
    const tag = record?.role ?? record?.type ?? 'item'
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 8)
    return `${tag}:${json.length}:${hash}`
  })
}

interface CrossTurnDiff {
  stablePrefixLen: number
  totalItems: number
  diverged: { index: number, before: string, after: string }[]
}

function crossTurnDiff(
  prev: readonly unknown[] | undefined,
  cur: readonly unknown[] | undefined,
): CrossTurnDiff | undefined {
  if (prev === undefined || cur === undefined)
    return undefined
  const json = (items: readonly unknown[], i: number): string => JSON.stringify(items[i]) ?? ''
  let stable = 0
  while (stable < prev.length && stable < cur.length && json(prev, stable) === json(cur, stable))
    stable++
  const diverged: CrossTurnDiff['diverged'] = []
  for (let i = stable; i < Math.min(prev.length, cur.length); i++) {
    const before = json(prev, i)
    const after = json(cur, i)
    if (before !== after)
      diverged.push({ index: i, ...windowDiff(before, after) })
  }
  return { stablePrefixLen: stable, totalItems: cur.length, diverged }
}

function windowDiff(before: string, after: string): { before: string, after: string } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head])
    head++
  const start = Math.max(0, head - DIVERGED_CONTENT_LEAD)
  const slice = (text: string): string => {
    const end = start + DIVERGED_CONTENT_LEAD + DIVERGED_CONTENT_CAP
    const lead = start > 0 ? `…(+${start})` : ''
    const tail = end < text.length ? `…(+${text.length - end})` : ''
    return `${lead}${text.slice(start, end)}${tail}`
  }
  return { before: slice(before), after: slice(after) }
}

function formatPrefixLine(model: string, diff: CrossTurnDiff): string {
  const base = `[prefix] ${model}: ${diff.stablePrefixLen}/${diff.totalItems} items stable`
  const first = diff.diverged[0]
  if (first === undefined)
    return `${base} (append-only)`
  const delta = first.after.length - first.before.length
  const sign = delta >= 0 ? '+' : ''
  return `${base}; broke@${first.index} Δ${sign}${delta} (${first.before.length}→${first.after.length} chars)`
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const UsageDetailsSchema = Type.Object({
  cached_tokens: Type.Optional(Type.Number()),
})

const UsageRecordSchema = Type.Object({
  output_tokens: Type.Optional(Type.Number()),
  completion_tokens: Type.Optional(Type.Number()),
  cache_read_input_tokens: Type.Optional(Type.Number()),
  cache_creation_input_tokens: Type.Optional(Type.Number()),
  input_tokens: Type.Optional(Type.Number()),
  prompt_tokens: Type.Optional(Type.Number()),
  input_tokens_details: Type.Optional(UsageDetailsSchema),
  prompt_tokens_details: Type.Optional(UsageDetailsSchema),
})

const ObjectSchema = Type.Object({}, { additionalProperties: true })

export function normalizeUsage(usage: unknown): UsageSummary {
  const rawRecord = asValue(ObjectSchema, usage)
  if (rawRecord === undefined || Object.keys(rawRecord).length === 0) {
    return {
      shape: 'unavailable',
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      hitRate: undefined,
    }
  }
  const record = asValue(UsageRecordSchema, usage) ?? {}
  const output = num(record.output_tokens ?? record.completion_tokens)

  const cacheRead = record.cache_read_input_tokens
  const cacheWrite = record.cache_creation_input_tokens
  if (cacheRead !== undefined || cacheWrite !== undefined) {
    const read = num(cacheRead)
    const write = num(cacheWrite)
    const uncached = num(record.input_tokens)
    const total = read + write + uncached
    return {
      shape: 'anthropic',
      inputTokens: total,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      uncachedInputTokens: uncached,
      outputTokens: output,
      hitRate: total > 0 ? read / total : undefined,
    }
  }

  const details = record.input_tokens_details ?? record.prompt_tokens_details
  if (details?.cached_tokens !== undefined) {
    const total = num(record.input_tokens ?? record.prompt_tokens)
    const read = num(details.cached_tokens)
    return {
      shape: 'openai',
      inputTokens: total,
      cacheReadTokens: read,
      cacheWriteTokens: 0,
      uncachedInputTokens: Math.max(0, total - read),
      outputTokens: output,
      hitRate: total > 0 ? read / total : undefined,
    }
  }

  const total = num(record.input_tokens ?? record.prompt_tokens)
  return {
    shape: 'unknown',
    inputTokens: total,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    uncachedInputTokens: total,
    outputTokens: output,
    hitRate: undefined,
  }
}

export function createContextUsagePart(usage: unknown): LanguageModelDataPart | undefined {
  const summary = normalizeUsage(usage)
  const { inputTokens, outputTokens, cacheReadTokens } = summary
  if (inputTokens <= 0 && outputTokens <= 0)
    return undefined
  return LanguageModelDataPart.json({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    ...(summary.shape !== 'unknown' ? { prompt_tokens_details: { cached_tokens: cacheReadTokens } } : {}),
  }, 'usage')
}

function formatHitRate(hitRate: number | undefined): string {
  return hitRate === undefined ? 'n/a' : `${Math.round(hitRate * 100)}%`
}

export function formatUsageLine(
  model: string,
  summary: UsageSummary,
  raw?: unknown,
  reasoningEffort?: string,
): string {
  const effort = reasoningEffort !== undefined && reasoningEffort.length > 0 ? ` effort=${reasoningEffort}` : ''
  if (summary.shape === 'unavailable')
    return `[usage] ${model}:${effort} input=n/a cached=n/a write=n/a output=n/a hit=n/a (unavailable)`
  const cached = summary.shape === 'unknown' ? 'n/a' : summary.cacheReadTokens
  const base = `[usage] ${model}:${effort} input=${summary.inputTokens} cached=${cached}`
    + ` write=${summary.cacheWriteTokens} output=${summary.outputTokens} hit=${formatHitRate(summary.hitRate)}`
  if (summary.shape !== 'unknown')
    return base
  return `${base} raw=${JSON.stringify(raw)}`
}

export class CacheMetricsTracker {
  private readonly statusBar: StatusBarItem
  private readonly totals = { read: 0, write: 0, uncached: 0, output: 0, requests: 0, requestsWithUsage: 0 }
  private readonly lastItemsByCacheKey = new Map<string, readonly unknown[]>()
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: OutputChannel,
  ) {
    this.statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 99)
    this.statusBar.command = 'universalChatProvider.showLogs'
    if (this.enabled())
      this.updateStatusBar()
    else
      this.statusBar.hide()
  }

  start(context: UsageContext): (usage: unknown) => void {
    let diff: CrossTurnDiff | undefined
    if (this.enabled() && context.promptCacheKey !== undefined && context.inputItems !== undefined) {
      diff = crossTurnDiff(this.lastItemsByCacheKey.get(context.promptCacheKey), context.inputItems)
      this.lastItemsByCacheKey.set(context.promptCacheKey, context.inputItems)
    }
    return usage => this.record(usage, context, diff)
  }

  private record(usage: unknown, context: UsageContext, diff: CrossTurnDiff | undefined): void {
    const summary = normalizeUsage(usage)
    this.output.appendLine(formatUsageLine(context.model, summary, usage, context.reasoningEffort))
    if (!this.enabled()) {
      this.statusBar.hide()
      return
    }
    if (diff !== undefined)
      this.output.appendLine(formatPrefixLine(context.model, diff))
    this.accumulate(summary)
    this.updateStatusBar()
    this.append(summary, context, usage, diff)
  }

  dispose(): void {
    this.statusBar.dispose()
  }

  async flush(): Promise<void> {
    await this.writes
  }

  private enabled(): boolean {
    return workspace.getConfiguration('universalChatProvider').get<boolean>(ENABLED_SETTING, false)
  }

  private accumulate(summary: UsageSummary): void {
    this.totals.requests += 1
    if (summary.shape === 'unavailable')
      return
    this.totals.requestsWithUsage += 1
    if (summary.shape !== 'unknown') {
      this.totals.read += summary.cacheReadTokens
      this.totals.write += summary.cacheWriteTokens
      this.totals.uncached += summary.uncachedInputTokens
    }
    this.totals.output += summary.outputTokens
  }

  private updateStatusBar(): void {
    const { read, write, uncached, output, requests, requestsWithUsage } = this.totals
    const input = read + write + uncached
    const rate = input > 0 ? `${Math.round((read / input) * 100)}%` : 'n/a'
    this.statusBar.text = `$(database) ${rate} cached`
    this.statusBar.tooltip = `Prompt cache hit rate this session: ${rate}\n`
      + `cache read ${read} · cache write ${write} · uncached ${uncached} · output ${output}\n`
      + `${requests} request${requests === 1 ? '' : 's'}, ${requestsWithUsage} with usage — logged to ${LOG_FILE}`
    this.statusBar.show()
  }

  private append(summary: UsageSummary, context: UsageContext, raw: unknown, diff: CrossTurnDiff | undefined): void {
    const entry = {
      ts: new Date().toISOString(),
      model: context.model,
      promptCacheKey: context.promptCacheKey,
      reasoningEffort: context.reasoningEffort ?? null,
      shape: summary.shape,
      inputTokens: summary.inputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens,
      uncachedInputTokens: summary.uncachedInputTokens,
      outputTokens: summary.outputTokens,
      hitRate: summary.hitRate ?? null,
      inputPrefix: fingerprintInput(context.inputItems) ?? null,
      crossTurn: diff ?? null,
      raw: raw ?? null,
    }
    const directory = this.context.globalStorageUri.fsPath
    const file = join(directory, LOG_FILE)
    this.writes = this.writes
      .then(async () => {
        await mkdir(directory, { recursive: true })
        await appendFile(file, `${JSON.stringify(entry)}\n`)
      })
      .catch(error => this.output.appendLine(`[cache-metrics] write failed: ${errorMessage(error)}`))
  }
}
