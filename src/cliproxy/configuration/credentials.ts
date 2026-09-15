import type { ExtensionContext } from 'vscode'
import { ConfigurationTarget, window, workspace } from 'vscode'

export const SECRET_KEY = 'universalChatProvider.apiKey'

export class CredentialStore {
  constructor(private readonly context: ExtensionContext) {}

  get(): Thenable<string | undefined> {
    return this.context.secrets.get(SECRET_KEY)
  }

  set(value: string): Thenable<void> {
    return this.context.secrets.store(SECRET_KEY, value)
  }

  clear(): Thenable<void> {
    return this.context.secrets.delete(SECRET_KEY)
  }

  async prompt(): Promise<string | undefined> {
    const value = await window.showInputBox({
      title: 'CLIProxyAPI API Key',
      prompt: 'Enter an API key accepted by the local CLIProxyAPI server.',
      password: true,
      ignoreFocusOut: true,
      validateInput: input => input.trim() ? undefined : 'An API key is required.',
    })
    if (value === undefined || value.length === 0)
      return undefined
    await this.set(value.trim())
    return value.trim()
  }
}

export async function configureConnection(): Promise<boolean> {
  const settings = workspace.getConfiguration('universalChatProvider')
  const baseUrl = await window.showInputBox({
    title: 'CLIProxyAPI Base URL',
    value: settings.get<string>('baseUrl', 'http://127.0.0.1:8317'),
    prompt: 'Base URL of the CLIProxyAPI server.',
    ignoreFocusOut: true,
    validateInput: validateHttpUrl,
  })
  if (baseUrl === undefined || baseUrl.length === 0)
    return false
  await settings.update('baseUrl', normalizeBaseUrl(baseUrl), ConfigurationTarget.Global)

  return true
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function validateHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? undefined
      : 'Use an http:// or https:// URL.'
  }
  catch {
    return 'Enter a valid URL.'
  }
}
