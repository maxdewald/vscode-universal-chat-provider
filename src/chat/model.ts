import type { Static } from '@sinclair/typebox'
import type { LanguageModelChatInformation } from 'vscode'
import type { CatalogModel } from './catalog'
import { Type } from '@sinclair/typebox'
import { capitalize, unique } from 'moderndash'

export const ProxyModelListEntrySchema = Type.Object({
  id: Type.String(),
  owned_by: Type.Optional(Type.String()),
  context_length: Type.Optional(Type.Number()),
  max_completion_tokens: Type.Optional(Type.Number()),
}, { additionalProperties: true })

export type ProxyModelListEntry = Static<typeof ProxyModelListEntrySchema>

const SupportedReasoningLevelSchema = Type.Object({
  effort: Type.String(),
}, { additionalProperties: true })

export const ProxyModelMetadataSchema = Type.Object({
  slug: Type.String(),
  display_name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  context_window: Type.Optional(Type.Number()),
  max_context_window: Type.Optional(Type.Number()),
  visibility: Type.Optional(Type.String()),
  supported_in_api: Type.Optional(Type.Boolean()),
  input_modalities: Type.Optional(Type.Array(Type.String())),
  supports_parallel_tool_calls: Type.Optional(Type.Boolean()),
  supported_reasoning_levels: Type.Optional(Type.Array(SupportedReasoningLevelSchema)),
  default_reasoning_level: Type.Optional(Type.String()),
}, { additionalProperties: true })

export type ProxyModelMetadata = Static<typeof ProxyModelMetadataSchema>

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
    const catalogModel = resolveCatalogModel(entry.id, catalog)
    if (isMediaOnly(entry.id, catalogModel))
      continue

    const totalContext = firstPositiveInteger(
      entry.context_length,
      detail?.context_window,
      catalogModel?.context_length,
      catalogModel?.inputTokenLimit,
    )
    const outputTokens = firstPositiveInteger(
      entry.max_completion_tokens,
      catalogModel?.max_completion_tokens,
      catalogModel?.outputTokenLimit,
    )
    if (totalContext === undefined || outputTokens === undefined) {
      options.onSkipped?.(
        entry.id,
        'model is not supported: context window and output tokens must be supplied manually',
      )
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
      totalContext,
      outputTokens,
    })
  }

  const ambiguousNames = ambiguousDisplayNames(candidates, options)
  return candidates.map(candidate => toProviderModel(candidate, ambiguousNames.has(displayBaseKey(candidate)))).sort((a, b) => {
    const baseA = a.name.replace(REASONING_NAME_SUFFIX, '')
    const baseB = b.name.replace(REASONING_NAME_SUFFIX, '')
    return baseA === baseB
      ? effortRank(a.reasoningEffort) - effortRank(b.reasoningEffort)
      : baseA.localeCompare(baseB)
  })
}

function ambiguousDisplayNames(candidates: readonly ModelCandidate[], options: ModelMappingOptions): Set<string> {
  const ambiguous = new Set<string>()
  for (const [key, group] of Map.groupBy(candidates, displayBaseKey)) {
    if (group.length > 1) {
      ambiguous.add(key)
      options.onCollision?.(`Model display collision for ${formatProviderName(group[0]!.providerName)} "${group[0]!.baseName}": ${group.map(candidate => candidate.entry.id).join(', ')}; showing full IDs.`)
    }
  }
  return ambiguous
}

function displayBaseKey(candidate: ModelCandidate): string {
  return `${candidate.providerName}\0${candidate.baseName}`.toLowerCase()
}

function toProviderModel(candidate: ModelCandidate, useFullId: boolean): ProviderModel {
  const { entry, detail, catalogModel, providerName, levels, totalContext, outputTokens } = candidate
  const name = useFullId ? entry.id : candidate.baseName
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

const tokenFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function formatTokens(value: number): string {
  return tokenFormat.format(value)
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

function resolveCatalogModel(id: string, catalog: ReadonlyMap<string, CatalogModel>): CatalogModel | undefined {
  return catalog.get(id) ?? catalog.get(id.split('/').pop()!)
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
