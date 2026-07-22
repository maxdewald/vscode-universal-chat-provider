import type { CatalogModel } from '../chat/catalog'

export interface ProxyConnection {
  ensureReady: (interactive: boolean) => Promise<void>
  baseUrl: () => string
  enrichOpenAICompatibilityThinking?: (catalog: ReadonlyMap<string, CatalogModel>) => Promise<boolean>
}
