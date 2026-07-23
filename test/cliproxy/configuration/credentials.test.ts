import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  configCandidates,
  configureConnection,
  CredentialStore,
  findConfigPath,
  normalizeBaseUrl,
} from '../../../src/cliproxy/configuration/credentials'
import { useTempDirectories } from '../../support/temp'
import { createExtensionContext, resetVSCodeMock, vscodeMock, window } from '../../support/vscode'

const makeTempDirectory = useTempDirectories()

beforeEach(() => {
  resetVSCodeMock()
})

describe('credentials', () => {
  it('normalizes URLs and resolves configured or default config candidates', () => {
    expect(normalizeBaseUrl(' https://proxy/// ')).toBe('https://proxy')

    vscodeMock.settings.set('universalChatProvider.configPath', '~/custom.yaml')
    expect(configCandidates()).toEqual([join(homedir(), 'custom.yaml')])

    vscodeMock.settings.delete('universalChatProvider.configPath')
    expect(configCandidates()).toEqual([
      join(homedir(), 'cliproxyapi', 'config.yaml'),
      join(homedir(), '.config', 'cliproxyapi', 'config.yaml'),
      join(homedir(), '.cli-proxy-api', 'config.yaml'),
    ])

    vscodeMock.settings.set('universalChatProvider.autoDetectConfig', false)
    expect(configCandidates()).toEqual([])
  })

  it('finds the configured file and imports its first usable key', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-credentials-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, 'api-keys:\n  - imported-key\n')
    vscodeMock.settings.set('universalChatProvider.configPath', configPath)
    const context = createExtensionContext()
    const store = new CredentialStore(context)

    await expect(findConfigPath()).resolves.toBe(configPath)
    await expect(store.inspectLocalConfig()).resolves.toMatchObject({ path: configPath, apiKey: 'imported-key' })
    await expect(store.importFromConfig(true)).resolves.toBe('imported-key')
    await expect(context.secrets.get('universalChatProvider.apiKey')).resolves.toBe('imported-key')
  })

  it('reports missing, unusable, and malformed configs only when requested', async () => {
    const context = createExtensionContext()
    const store = new CredentialStore(context)
    vscodeMock.settings.set('universalChatProvider.autoDetectConfig', false)

    await expect(store.importFromConfig(true)).resolves.toBeUndefined()
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'No CLIProxyAPI config.yaml was found. Configure its path in settings.',
    )

    const directory = await makeTempDirectory('universal-chat-provider-credentials-')
    const configPath = join(directory, 'config.yaml')
    vscodeMock.settings.set('universalChatProvider.configPath', configPath)
    await writeFile(configPath, 'api-keys:\n  - your-api-key\n')
    await expect(store.importFromConfig(true)).resolves.toBeUndefined()
    expect(window.showWarningMessage).toHaveBeenCalledWith(`No usable API key was found in ${configPath}.`)

    await writeFile(configPath, 'invalid: [')
    await expect(store.importFromConfig(false)).resolves.toBeUndefined()
    expect(window.showErrorMessage).not.toHaveBeenCalled()
    await expect(store.importFromConfig(true)).resolves.toBeUndefined()
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Could not read CLIProxyAPI config:'))
  })

  it('prompts, trims, stores, retrieves, and clears secrets', async () => {
    const context = createExtensionContext()
    const store = new CredentialStore(context)
    window.showInputBox.mockResolvedValueOnce('  entered-key  ')

    await expect(store.prompt()).resolves.toBe('entered-key')
    await expect(store.get()).resolves.toBe('entered-key')
    await store.clear()
    await expect(store.get()).resolves.toBeUndefined()

    window.showInputBox.mockResolvedValueOnce(undefined)
    await expect(store.prompt()).resolves.toBeUndefined()
  })

  it('configures the URL and optional path, respecting cancellation', async () => {
    window.showInputBox
      .mockResolvedValueOnce(' http://proxy/// ')
      .mockResolvedValueOnce('  /proxy/config.yaml  ')

    await expect(configureConnection()).resolves.toBe(true)
    expect(vscodeMock.settings.get('universalChatProvider.baseUrl')).toBe('http://proxy')
    expect(vscodeMock.settings.get('universalChatProvider.configPath')).toBe('/proxy/config.yaml')

    window.showInputBox.mockResolvedValueOnce(undefined)
    await expect(configureConnection()).resolves.toBe(false)

    const validation = window.showInputBox.mock.calls[0]?.[0]?.validateInput
    expect(validation?.('ftp://proxy')).toBe('Use an http:// or https:// URL.')
    expect(validation?.('not a url')).toBe('Enter a valid URL.')
    expect(validation?.('https://proxy')).toBeUndefined()
  })
})
