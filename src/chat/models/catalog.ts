import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'
import ky from 'ky'

const CatalogPayloadSchema = Type.Object({}, { additionalProperties: true })

const MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json'
const MODELS_DEV_CATALOG_URL = 'https://models.dev/catalog.json'
let catalogCache: ModelCatalogs | undefined

const CatalogThinkingSchema = Type.Object({
  max: Type.Optional(Type.Number()),
  zero_allowed: Type.Optional(Type.Boolean()),
  dynamic_allowed: Type.Optional(Type.Boolean()),
  levels: Type.Optional(Type.Array(Type.String())),
})

const CatalogModelSchema = Type.Object({
  id: Type.String(),
  type: Type.Optional(Type.String()),
  display_name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  context_length: Type.Optional(Type.Number()),
  max_completion_tokens: Type.Optional(Type.Number()),
  inputTokenLimit: Type.Optional(Type.Number()),
  outputTokenLimit: Type.Optional(Type.Number()),
  supported_parameters: Type.Optional(Type.Array(Type.String())),
  supportedInputModalities: Type.Optional(Type.Array(Type.String())),
  supportedOutputModalities: Type.Optional(Type.Array(Type.String())),
  thinking: Type.Optional(CatalogThinkingSchema),
})

const ModelsDevModelSchema = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  reasoning_options: Type.Optional(Type.Array(Type.Object({
    values: Type.Optional(Type.Array(Type.Unknown())),
  }, { additionalProperties: true }))),
  tool_call: Type.Optional(Type.Boolean()),
  modalities: Type.Optional(Type.Object({
    input: Type.Optional(Type.Array(Type.String())),
    output: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true })),
  limit: Type.Optional(Type.Object({
    context: Type.Optional(Type.Number()),
    input: Type.Optional(Type.Number()),
    output: Type.Optional(Type.Number()),
  }, { additionalProperties: true })),
}, { additionalProperties: true })

const ModelsDevCatalogSchema = Type.Object({
  providers: Type.Optional(Type.Record(Type.String(), Type.Object({
    id: Type.String(),
    api: Type.Optional(Type.String()),
    models: Type.Record(Type.String(), ModelsDevModelSchema),
  }, { additionalProperties: true }))),
  models: Type.Optional(Type.Record(Type.String(), ModelsDevModelSchema)),
}, { additionalProperties: true })

type ModelsDevModel = Static<typeof ModelsDevModelSchema>

export type CatalogModel = Static<typeof CatalogModelSchema>

export interface ModelCatalogs {
  router: Map<string, CatalogModel>
  modelsDev: Map<string, CatalogModel>
}

export async function fetchCatalog(signal?: AbortSignal): Promise<ModelCatalogs> {
  if (catalogCache)
    return catalogCache
  const [routerPayload, modelsDevPayload] = await Promise.all([
    fetchPayload(MODEL_CATALOG_URL, signal),
    fetchPayload(MODELS_DEV_CATALOG_URL, signal),
  ])
  catalogCache = {
    router: flattenCatalog(routerPayload),
    modelsDev: flattenModelsDevCatalog(modelsDevPayload),
  }
  return catalogCache
}

export function flattenCatalog(payload: unknown): Map<string, CatalogModel> {
  const result = new Map<string, CatalogModel>()
  const root = asValue(CatalogPayloadSchema, payload)
  if (root === undefined)
    return result

  for (const value of Object.values(root)) {
    if (!Array.isArray(value))
      continue
    for (const candidate of value) {
      const model = asValue(CatalogModelSchema, candidate)
      if (model === undefined)
        continue
      const current = result.get(model.id)
      if (!current || scoreCatalogModel(model) > scoreCatalogModel(current))
        result.set(model.id, model)
    }
  }
  return result
}

function scoreCatalogModel(model: CatalogModel): number {
  return Number((model.context_length ?? model.inputTokenLimit ?? 0) > 0)
    + Number((model.max_completion_tokens ?? model.outputTokenLimit ?? 0) > 0)
    + Number(model.thinking !== undefined)
}

async function fetchPayload(url: string, signal?: AbortSignal): Promise<unknown | undefined> {
  try {
    return await ky.get(url, { fetch: globalThis.fetch, signal: signal ?? null }).json<unknown>()
  }
  catch {
    return undefined
  }
}

function flattenModelsDevCatalog(payload: unknown): Map<string, CatalogModel> {
  const result = new Map<string, CatalogModel>()
  const modelsDev = asValue(ModelsDevCatalogSchema, payload)
  if (modelsDev === undefined)
    return result

  for (const [id, candidate] of Object.entries(modelsDev.models ?? {})) {
    const model = toCatalogModel(candidate)
    result.set(id, model)
    result.set(id.slice(id.lastIndexOf('/') + 1), model)
  }

  for (const [providerId, provider] of Object.entries(modelsDev.providers ?? {})) {
    for (const [modelId, candidate] of Object.entries(provider.models)) {
      const model = toCatalogModel(candidate)
      result.set(`${providerId}/${modelId}`, model)
      const hostname = provider.api === undefined ? undefined : apiHostname(provider.api)
      if (hostname !== undefined)
        result.set(`${hostname}/${modelId}`, model)
    }
  }
  return result
}

function toCatalogModel(model: ModelsDevModel): CatalogModel {
  const levels = model.reasoning_options
    ?.flatMap(option => option.values ?? [])
    .filter((value): value is string => typeof value === 'string') ?? []
  const output = model.limit?.output
  const input = model.limit?.input
    ?? (model.limit?.context === undefined || output === undefined
      ? undefined
      : output < model.limit.context ? model.limit.context - output : model.limit.context)
  return {
    id: model.id,
    ...(model.name === undefined ? {} : { display_name: model.name }),
    ...(model.description === undefined ? {} : { description: model.description }),
    ...(input === undefined ? {} : { context_length: input }),
    ...(output === undefined ? {} : { max_completion_tokens: output }),
    ...(model.tool_call === undefined ? {} : { supported_parameters: model.tool_call ? ['tools'] : [] }),
    ...(model.modalities?.input === undefined ? {} : { supportedInputModalities: model.modalities.input }),
    ...(model.modalities?.output === undefined ? {} : { supportedOutputModalities: model.modalities.output }),
    ...(levels.length === 0 ? {} : { thinking: { levels } }),
  }
}

function apiHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  }
  catch {
    return undefined
  }
}
