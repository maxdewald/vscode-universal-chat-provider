import { workspace } from 'vscode'
import { normalizeBaseUrl } from './credentials'

/**
 * Resolves the proxy connection. The default reads user settings (the external
 * BYO server); the managed controller implements the same shape and additionally
 * starts/supervises a bundled server before reporting its URL.
 */
export interface ProxyConnection {
  ensureReady: (interactive: boolean) => Promise<void>
  baseUrl: () => string
}

/** The external (bring-your-own-server) connection backed purely by settings. */
export class SettingsConnection implements ProxyConnection {
  async ensureReady(): Promise<void> {}

  baseUrl(): string {
    return normalizeBaseUrl(
      workspace.getConfiguration('universalChatProvider').get<string>('baseUrl', 'http://127.0.0.1:8317'),
    )
  }
}
