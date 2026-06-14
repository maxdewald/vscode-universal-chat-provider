import type { ExtensionContext } from 'vscode'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ConfigurationTarget, window, workspace } from 'vscode'
import { parse } from 'yaml'

const SECRET_KEY = 'cliproxyapi.apiKey'
const PLACEHOLDER_KEY = /^your-api-key(?:-\d+)?$/i

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

  async importFromConfig(interactive: boolean): Promise<string | undefined> {
    const configPath = await findConfigPath()
    if (configPath === undefined) {
      if (interactive)
        void window.showWarningMessage('No CLIProxyAPI config.yaml was found. Configure its path in settings.')
      return undefined
    }

    let key: string | undefined
    try {
      const document = parse(await readFile(configPath, 'utf8'), {
        prettyErrors: true,
        strict: true,
        stringKeys: true,
      }) as unknown
      key = firstApiKey(document)
    }
    catch (error) {
      if (interactive)
        void window.showErrorMessage(`Could not read CLIProxyAPI config: ${errorMessage(error)}`)
      return undefined
    }

    if (key === undefined) {
      if (interactive)
        void window.showWarningMessage(`No usable API key was found in ${configPath}.`)
      return undefined
    }

    if (interactive) {
      const choice = await window.showInformationMessage(
        `Import the first CLIProxyAPI API key from ${configPath} into VS Code SecretStorage?`,
        { modal: true },
        'Import',
      )
      if (choice !== 'Import')
        return undefined
    }

    await this.set(key)
    return key
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

export async function findConfigPath(): Promise<string | undefined> {
  const settings = workspace.getConfiguration('modelProvider')
  const configured = settings.get<string>('configPath', '').trim()
  const candidates = configured.length > 0
    ? [expandHome(configured)]
    : settings.get<boolean>('autoDetectConfig', true)
      ? [
          join(homedir(), 'cliproxyapi', 'config.yaml'),
          join(homedir(), '.config', 'cliproxyapi', 'config.yaml'),
          join(homedir(), '.cli-proxy-api', 'config.yaml'),
        ]
      : []

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    }
    catch {}
  }
  return undefined
}

export async function configureConnection(): Promise<void> {
  const settings = workspace.getConfiguration('modelProvider')
  const baseUrl = await window.showInputBox({
    title: 'CLIProxyAPI Base URL',
    value: settings.get<string>('baseUrl', 'http://127.0.0.1:8317'),
    prompt: 'Base URL of the CLIProxyAPI server.',
    ignoreFocusOut: true,
    validateInput: validateHttpUrl,
  })
  if (baseUrl === undefined || baseUrl.length === 0)
    return
  await settings.update('baseUrl', normalizeBaseUrl(baseUrl), ConfigurationTarget.Global)

  const configPath = await window.showInputBox({
    title: 'CLIProxyAPI Config Path',
    value: settings.get<string>('configPath', ''),
    prompt: 'Optional path to config.yaml. Leave blank to use automatic detection.',
    ignoreFocusOut: true,
  })
  if (configPath !== undefined)
    await settings.update('configPath', configPath.trim(), ConfigurationTarget.Global)
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function firstApiKey(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value['api-keys']))
    return undefined
  return value['api-keys'].find((candidate): candidate is string =>
    typeof candidate === 'string'
    && candidate.trim().length > 0
    && !PLACEHOLDER_KEY.test(candidate.trim()),
  )?.trim()
}

function expandHome(value: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  return isAbsolute(expanded) ? expanded : resolve(expanded)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
