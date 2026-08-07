export interface ProxyConnection {
  ensureReady: (interactive: boolean) => Promise<void>
  baseUrl: () => string
  acquireRequest: () => Promise<() => void>
}
