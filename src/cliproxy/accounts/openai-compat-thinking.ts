import type { CatalogModel } from '@src/chat/models/catalog'
import type { OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import { matchCatalogModel } from '@src/chat/models/catalog-match'
import { unique } from 'moderndash'

export function enrichOpenAICompatibilityProviders(
  providers: readonly OpenAICompatibilityProvider[],
  catalog: ReadonlyMap<string, CatalogModel>,
): boolean {
  let changed = false
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      if (model.thinking?.levels !== undefined && model.thinking.levels.length > 0)
        continue
      const levels = thinkingLevels(model.name, catalog)
      if (levels === undefined)
        continue
      model.thinking = { levels }
      changed = true
    }
  }
  return changed
}

function thinkingLevels(
  modelId: string,
  catalog: ReadonlyMap<string, CatalogModel>,
): string[] | undefined {
  const levels = matchCatalogModel(modelId, catalog)?.thinking?.levels
  if (levels === undefined || levels.length === 0)
    return undefined
  return unique(levels.map(value => value.trim().toLowerCase()).filter(Boolean))
}
