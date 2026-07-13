import type { LanguageModelChatInformation } from 'vscode'
import type { CatalogModel } from './catalog'
import { capitalize, unique } from 'moderndash'

export interface ProxyModelListEntry {
  id: string
  owned_by?: string
  context_length?: number
  max_completion_tokens?: number
}

export interface ProxyModelMetadata {
  slug: string
  display_name?: string
  description?: string
  context_window?: number
  max_context_window?: number
  visibility?: string
  supported_in_api?: boolean
  input_modalities?: string[]
  supports_parallel_tool_calls?: boolean
  supported_reasoning_levels?: { effort: string }[]
  default_reasoning_level?: string
}

export interface ProviderModel extends LanguageModelChatInformation {
  proxyModelId: string
  proxyOwner: string
  reasoningLevels: readonly string[]
  reasoningEffort?: string
  supportsParallelToolCalls: boolean
  configurationSchema?: ModelConfigurationSchema
}

interface ModelConfigurationSchema {
  properties: {
    reasoningEffort: {
      type: 'string'
      enum: readonly string[]
      enumItemLabels: readonly string[]
      default: string
      description: string
      group: 'navigation'
    }
  }
}

export interface ModelMappingOptions {
  onSkipped?: (id: string, reason: string) => void
  onCollision?: (message: string) => void
}

const REASONING_NAME_SUFFIX = /\s+\((?:thinking|none|minimal|low|medium|high|extra high|xhigh|max|auto)\)$/i

interface ModelCandidate {
  entry: ProxyModelListEntry
  detail: ProxyModelMetadata | undefined
  catalogModel: CatalogModel | undefined
  providerName: string
  advertisedName: string
  baseName: string
  levels: string[]
  levelSignature: string
  totalContext: number
  outputTokens: number
}

export function mapProxyModels(
  available: readonly ProxyModelListEntry[],
  metadata: readonly ProxyModelMetadata[],
  catalog: ReadonlyMap<string, CatalogModel>,
  options: ModelMappingOptions,
): ProviderModel[] {
  const metadataById = new Map(metadata.map(model => [model.slug, model]))
  const seen = new Set<string>()
  const candidates: ModelCandidate[] = []

  for (const entry of available) {
    if (!entry.id || seen.has(entry.id))
      continue
    seen.add(entry.id)

    const detail = metadataById.get(entry.id)
    const catalogModel = catalog.get(entry.id)
    if (isMediaOnly(entry.id, catalogModel))
      continue

    const totalContext = firstPositiveInteger(
      entry.context_length,
      detail?.context_window,
      catalogModel?.context_length,
      catalogModel?.inputTokenLimit,
    )
    if (totalContext === undefined) {
      options.onSkipped?.(entry.id, 'no context window reported by the proxy')
      continue
    }

    const outputTokens = firstPositiveInteger(
      entry.max_completion_tokens,
      catalogModel?.max_completion_tokens,
      catalogModel?.outputTokenLimit,
    )
    if (outputTokens === undefined) {
      options.onSkipped?.(entry.id, 'no output token limit reported by the proxy')
      continue
    }
    const levels = resolveReasoning(detail, catalogModel)
    const advertisedName = displayModelName(entry.id, detail, catalogModel)
    const baseName = normalizeReasoningModelName(advertisedName, levels)
    const providerName = entry.owned_by ?? catalogModel?.type ?? 'proxy'
    candidates.push({
      entry,
      detail,
      catalogModel,
      providerName,
      advertisedName,
      baseName,
      levels,
      levelSignature: [...levels].sort().join('\0'),
      totalContext,
      outputTokens,
    })
  }

  const winners = chooseDisplayModelWinners(candidates, options)
  const ambiguousNames = ambiguousDisplayNames(winners)
  return winners.map(candidate => toProviderModel(candidate, ambiguousNames.has(displayBaseKey(candidate)))).sort((a, b) => {
    const baseA = a.name.replace(REASONING_NAME_SUFFIX, '')
    const baseB = b.name.replace(REASONING_NAME_SUFFIX, '')
    return baseA === baseB
      ? effortRank(a.reasoningEffort) - effortRank(b.reasoningEffort)
      : baseA.localeCompare(baseB)
  })
}

function chooseDisplayModelWinners(candidates: readonly ModelCandidate[], options: ModelMappingOptions): ModelCandidate[] {
  const byDisplay = Map.groupBy(candidates, displayDedupeKey)
  return Array.from(byDisplay.values(), (group) => {
    if (group.length > 1)
      options.onCollision?.(formatCollision(group[0]!, group))
    return group[0]!
  })
}

function formatCollision(kept: ModelCandidate, candidates: readonly ModelCandidate[]): string {
  return `Model display collision for ${formatProviderName(kept.providerName)} "${kept.baseName}": ${candidates.map(candidate => candidate.entry.id).join(', ')}; keeping ${kept.entry.id}.`
}

function ambiguousDisplayNames(candidates: readonly ModelCandidate[]): Set<string> {
  const seen = new Set<string>()
  const ambiguous = new Set<string>()
  for (const candidate of candidates) {
    const key = displayBaseKey(candidate)
    if (seen.has(key))
      ambiguous.add(key)
    else
      seen.add(key)
  }
  return ambiguous
}

function displayDedupeKey(candidate: ModelCandidate): string {
  return `${displayBaseKey(candidate)}\0${candidate.levelSignature}`
}

function displayBaseKey(candidate: ModelCandidate): string {
  return `${candidate.providerName}\0${candidate.baseName}`.toLowerCase()
}

function toProviderModel(candidate: ModelCandidate, useAdvertisedName: boolean): ProviderModel {
  const { entry, detail, catalogModel, providerName, levels, totalContext, outputTokens } = candidate
  const name = useAdvertisedName ? candidate.advertisedName : candidate.baseName
  const displayProviderName = formatProviderName(providerName)
  const imageInput = detail?.input_modalities?.includes('image')
    ?? catalogModel?.supportedInputModalities?.some(value => value.toLowerCase() === 'image')
    ?? false
  const parallelToolCalls = detail?.supports_parallel_tool_calls
  const supportsParallelToolCalls = parallelToolCalls ?? true
  const toolCalling = parallelToolCalls !== undefined
    || (catalogModel?.supported_parameters?.includes('tools') ?? true)
  const description = detail?.description ?? catalogModel?.description
  const tooltip = buildTooltip(name, description, displayProviderName, outputTokens, imageInput, toolCalling)

  const baseModel = {
    proxyModelId: entry.id,
    proxyOwner: providerName,
    family: entry.id,
    version: catalogModel?.version ?? entry.id,
    maxInputTokens: totalContext,
    maxOutputTokens: outputTokens,
    supportsParallelToolCalls,
    detail: `${formatTokens(totalContext)} context · ${displayProviderName}`,
    tooltip,
    capabilities: {
      imageInput,
      toolCalling,
    },
  }

  if (levels.length >= 2) {
    const ordered = [...levels].sort((a, b) => effortRank(a) - effortRank(b))
    const defaultLevel = resolveDefaultLevel(detail?.default_reasoning_level, ordered)
    return {
      ...baseModel,
      id: entry.id,
      name,
      reasoningLevels: ordered,
      reasoningEffort: defaultLevel,
      configurationSchema: {
        properties: {
          reasoningEffort: {
            type: 'string',
            enum: ordered,
            enumItemLabels: ordered.map(formatLevel),
            default: defaultLevel,
            description: 'Thinking Effort',
            group: 'navigation',
          },
        },
      },
    }
  }

  return { ...baseModel, id: entry.id, name, reasoningLevels: levels }
}

const EFFORT_RANK: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, auto: 7 }

function effortRank(level: string | undefined): number {
  return level === undefined ? -1 : EFFORT_RANK[level] ?? 99
}

function resolveDefaultLevel(advertised: string | undefined, ordered: readonly string[]): string {
  const normalized = advertised?.trim().toLowerCase()
  if (normalized !== undefined && ordered.includes(normalized))
    return normalized
  return ordered[ordered.length - 2]!
}

function formatLevel(value: string): string {
  return value === 'xhigh' ? 'Extra High' : capitalize(value)
}

function resolveReasoning(
  metadata: ProxyModelMetadata | undefined,
  catalog: CatalogModel | undefined,
): string[] {
  const describedLevels = metadata?.supported_reasoning_levels
    ?.map(item => item.effort.trim().toLowerCase())
    .filter(Boolean)
  let levels = normalizedUnique(describedLevels ?? catalog?.thinking?.levels ?? [])

  if (levels.length === 0 && catalog?.thinking) {
    if (catalog.thinking.zero_allowed)
      levels.push('none')
    if (catalog.thinking.dynamic_allowed)
      levels.push('auto')
    if ((catalog.thinking.max ?? 0) > 0)
      levels.push('low', 'medium', 'high')
    levels = normalizedUnique(levels)
  }

  return levels
}

function isMediaOnly(id: string, model: CatalogModel | undefined): boolean {
  if (model?.type === 'openai-image')
    return true
  const outputs = model?.supportedOutputModalities?.map(value => value.toLowerCase())
  if (outputs !== undefined && outputs.length > 0 && !outputs.includes('text'))
    return true
  return /(?:^|[-_/])(?:image|video)(?:$|[-_/])/.test(id.toLowerCase())
}

function buildTooltip(
  name: string,
  description: string | undefined,
  provider: string,
  output: number,
  imageInput: boolean,
  toolCalling: boolean,
): string {
  const capabilities = [`${formatTokens(output)} max output`]
  if (imageInput)
    capabilities.push('Vision')
  if (toolCalling)
    capabilities.push('Tools')

  const lines = [`${provider} via CLIProxyAPI`, capabilities.join(' · ')]
  const summary = description?.trim()
  if (summary !== undefined && summary.length > 0 && !isNameEcho(summary, name))
    lines.unshift(endWithSentencePunctuation(summary))
  return lines.join('\n\n')
}

function endWithSentencePunctuation(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function isNameEcho(description: string, name: string): boolean {
  const normalize = (text: string): string =>
    text.trim().replace(/[.!?]+$/, '').replace(REASONING_NAME_SUFFIX, '').trim().toLowerCase()
  return normalize(description) === normalize(name)
}

function formatTokens(value: number): string {
  if (value >= 1_000_000)
    return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000)
    return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

function formatProviderName(value: string): string {
  const apps: Record<string, string> = {
    anthropic: 'Claude Code',
    openai: 'Codex',
    antigravity: 'Antigravity',
    xai: 'Grok',
  }
  const normalized = value.trim()
  return apps[normalized.toLowerCase()]
    ?? normalized.replace(/[a-z][\w'-]*/gi, word => capitalize(word))
}

function displayModelName(id: string, metadata: ProxyModelMetadata | undefined, catalog: CatalogModel | undefined): string {
  return metadata?.display_name ?? catalog?.display_name ?? humanizeModelId(id)
}

function humanizeModelId(id: string): string {
  return id.replace(/[-_/]+/g, ' ').replace(/[a-z][\w.]*/gi, word => capitalize(word))
}

function normalizeReasoningModelName(name: string, levels: readonly string[]): string {
  if (levels.length < 2)
    return name
  return name.replace(REASONING_NAME_SUFFIX, '')
}

function firstPositiveInteger(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (value !== undefined && Number.isFinite(value) && value > 0)
      return Math.floor(value)
  }
  return undefined
}

function normalizedUnique(values: readonly string[]): string[] {
  return unique(values.map(value => value.trim().toLowerCase()).filter(Boolean))
}
