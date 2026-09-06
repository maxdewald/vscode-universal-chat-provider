export interface ProxyConnection {
  ensureReady: () => Promise<void>
  baseUrl: () => string
  acquireRequest: () => Promise<() => void>
}
