import { workspace } from 'vscode'
import { normalizeBaseUrl } from './credentials'

export interface ProxyConnection {
  ensureReady: (interactive: boolean) => Promise<void>
  baseUrl: () => string
}

export class SettingsConnection implements ProxyConnection {
  async ensureReady(): Promise<void> {}

  baseUrl(): string {
    return normalizeBaseUrl(
      workspace.getConfiguration('universalChatProvider').get<string>('baseUrl', 'http://127.0.0.1:8317'),
    )
  }
}
