import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'

const CatalogPayloadSchema = Type.Object({}, { additionalProperties: true })

const MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json'
let catalogCache: Map<string, CatalogModel> | undefined

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

export type CatalogModel = Static<typeof CatalogModelSchema>

export async function fetchCatalog(signal?: AbortSignal): Promise<Map<string, CatalogModel>> {
  if (catalogCache)
    return catalogCache
  try {
    const response = await fetch(MODEL_CATALOG_URL, signal ? { signal } : {})
    if (!response.ok)
      return new Map()
    catalogCache = flattenCatalog(await response.json())
    return catalogCache
  }
  catch {
    return new Map()
  }
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
