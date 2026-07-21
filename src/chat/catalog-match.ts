import type { CatalogModel } from './catalog'

const VARIANT_SUFFIX = /-(?:openai-compact|nothinking|thinking-\d+|thinking|internet|search|online|minimal|medium|xhigh|high|low|none|max|ultra|auto)$/i

export function matchCatalogModel(
  id: string,
  catalog: ReadonlyMap<string, CatalogModel>,
): CatalogModel | undefined {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  for (const root of new Set([id, bare])) {
    for (const name of new Set([root, root.split(':')[0] ?? root])) {
      for (let current = name; ;) {
        const hit = catalog.get(current)
          ?? (current.includes('.') ? catalog.get(current.replaceAll('.', '-')) : undefined)
        if (hit !== undefined)
          return hit
        const next = current.replace(VARIANT_SUFFIX, '')
        if (next === current || next === '')
          break
        current = next
      }
    }
  }
  return undefined
}
