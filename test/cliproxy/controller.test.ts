import type { ExtensionContext } from 'vscode'
import { readdir, readFile } from 'node:fs/promises'
import process from 'node:process'
import { ManagementClient } from '@src/cliproxy/api/management-client'
import { ServerController } from '@src/cliproxy/controller'
import { managedPaths } from '@src/cliproxy/managed/config'
import { claimLease } from '@src/cliproxy/managed/leases'
import { OPENAI_COMPATIBILITY_SECRET } from '@src/cliproxy/managed/openai-compatibility-store'
import { ManagedServer } from '@src/cliproxy/managed/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { useChildProcesses } from '../support/process'
import { useTempDirectories } from '../support/temp'
import { createExtensionContext, resetVSCodeMock, vscodeMock, window, workspace } from '../support/vscode'

const makeTempDirectory = useTempDirectories()
const { spawnPersistentNodeProcess } = useChildProcesses()

describe('server controller lifecycle', () => {
  let root: string

  beforeEach(async () => {
    resetVSCodeMock()
    vscodeMock.settings.set('universalChatProvider.server.updatePolicy', 'manual')
    root = await makeTempDirectory('ucp-controller-')
    vi.spyOn(ManagedServer.prototype, 'ensureRunning').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('claims a lease on start and stops the sidecar when the last window closes', async () => {
    const shutdown = vi.spyOn(ManagedServer.prototype, 'shutdown').mockReturnValue()
    const dispose = vi.spyOn(ManagedServer.prototype, 'dispose').mockReturnValue()
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)
    expect(await readdir(managedPaths(root).leaseDir)).toEqual([String(process.pid)])

    controller.dispose()
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('leaves the sidecar running when another window still holds a lease', async () => {
    const shutdown = vi.spyOn(ManagedServer.prototype, 'shutdown').mockReturnValue()
    const dispose = vi.spyOn(ManagedServer.prototype, 'dispose').mockReturnValue()
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)

    claimLease(managedPaths(root).leaseDir, spawnPersistentNodeProcess().pid)

    controller.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(shutdown).not.toHaveBeenCalled()
  })

  it('prompts before a startup update when suggestUpdates is selected', async () => {
    vscodeMock.settings.set('universalChatProvider.server.updatePolicy', 'suggestUpdates')
    vi.spyOn(ManagedServer.prototype, 'installedVersion').mockReturnValue('7.2.5')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tag_name: 'v7.2.9' })))
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)
    await vi.waitFor(() => {
      expect(vscodeMock.output.appendLine).not.toHaveBeenCalledWith(expect.stringContaining('update check failed'))
      expect(vscodeMock.settings.get('universalChatProvider.server.updatePolicy')).toBe('suggestUpdates')
    })

    const { window } = await import('../support/vscode')
    await vi.waitFor(() => expect(window.showInformationMessage).toHaveBeenCalledWith(
      'CLIProxyAPI 7.2.9 is available (you\'re on 7.2.5).',
      'Update',
      'Not Now',
    ))
  })

  it('downgrades without asking when updates are automatic', async () => {
    vscodeMock.settings.set('universalChatProvider.server.updatePolicy', 'automatic')
    vi.spyOn(ManagedServer.prototype, 'installedVersion').mockReturnValue('7.2.116')
    const downloadBinary = vi.spyOn(ManagedServer.prototype, 'downloadBinary').mockResolvedValue('7.2.115')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tag_name: 'v8.0.0' })))
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)

    await vi.waitFor(() => expect(downloadBinary).toHaveBeenCalledWith('7.2.115'))
    expect(window.showWarningMessage).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('asks before downgrading when suggestUpdates is selected', async () => {
    vscodeMock.settings.set('universalChatProvider.server.updatePolicy', 'suggestUpdates')
    vi.spyOn(ManagedServer.prototype, 'installedVersion').mockReturnValue('7.2.116')
    const downloadBinary = vi.spyOn(ManagedServer.prototype, 'downloadBinary').mockResolvedValue('7.2.115')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tag_name: 'v8.0.0' })))
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)

    await vi.waitFor(() => expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('CLIProxyAPI 7.2.116 should be downgraded to 7.2.115.'),
      'Downgrade',
      'Not Now',
    ))
    expect(downloadBinary).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('keeps a manual version above the maximum', async () => {
    vscodeMock.settings.set('universalChatProvider.server.version', '8.0.0')
    const downloadBinary = vi.spyOn(ManagedServer.prototype, 'downloadBinary').mockResolvedValue('8.0.0')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.updateBinary()

    expect(downloadBinary).toHaveBeenCalledWith('8.0.0')
    controller.dispose()
  })

  it('caps the update command at the maximum supported version', async () => {
    vscodeMock.settings.set('universalChatProvider.server.updatePolicy', 'automatic')
    const downloadBinary = vi.spyOn(ManagedServer.prototype, 'downloadBinary').mockResolvedValue('7.2.115')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.updateBinary()

    expect(downloadBinary).toHaveBeenCalledWith('7.2.115')
    controller.dispose()
  })

  it('downloads binary updates without restarting the server', async () => {
    vscodeMock.settings.set('universalChatProvider.server.version', '8.0.0')
    const downloadBinary = vi.spyOn(ManagedServer.prototype, 'downloadBinary').mockResolvedValue('8.0.0')
    const restart = vi.spyOn(ManagedServer.prototype, 'restart')
    vi.spyOn(ManagedServer.prototype, 'installedVersion').mockReturnValue('7.2.5')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.updateBinary()

    expect(downloadBinary).toHaveBeenCalledWith('8.0.0')
    expect(restart).not.toHaveBeenCalled()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'CLIProxyAPI 8.0.0 downloaded. It will restart automatically when no requests are active.',
    )

    window.showWarningMessage.mockResolvedValueOnce('Restart')
    restart.mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:8317', port: 8317, version: '8.0.0' })
    await controller.restartServer()
    expect(restart).toHaveBeenCalledWith('manual command')
    controller.dispose()
  })

  it('writes the configured upstream proxy to managed config', async () => {
    vscodeMock.settings.set('universalChatProvider.server.proxyUrl', 'http://127.0.0.1:7890')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)

    const config = parse(await readFile(managedPaths(root).configPath, 'utf8')) as Record<string, unknown>
    expect(config['proxy-url']).toBe('http://127.0.0.1:7890')
    controller.dispose()
  })

  it('writes full request logging to managed config at the highest debug level', async () => {
    vscodeMock.settings.set('universalChatProvider.debugLevel', 'requestLogging')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)

    const config = parse(await readFile(managedPaths(root).configPath, 'utf8')) as Record<string, unknown>
    expect(config['debug']).toBe(true)
    expect(config['request-log']).toBe(true)
    controller.dispose()
  })

  it('generates managed config from persisted openai-compatible providers', async () => {
    const providers = [{
      'name': 'openrouter.ai',
      'base-url': 'https://openrouter.ai/api/v1',
      'api-key-entries': [{ 'api-key': 'sk-or' }],
      'models': [{ name: 'gpt-5.5', alias: 'openrouter.ai/gpt-5.5' }],
    }]
    const secrets = new Map([[OPENAI_COMPATIBILITY_SECRET, JSON.stringify(providers)]])
    const controller = new ServerController(
      createExtensionContext({ globalStoragePath: root, secrets }),
      vscodeMock.output as never,
      vscodeMock.output as never,
    )

    await controller.ensureReady(false)

    const config = parse(await readFile(managedPaths(root).configPath, 'utf8')) as Record<string, unknown>
    expect(config['openai-compatibility']).toEqual(providers)
    controller.dispose()
  })

  it.each([
    'universalChatProvider.server.proxyUrl',
    'universalChatProvider.debugLevel',
  ])('prompts before restarting for a managed server change to %s', async (changedSetting) => {
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)
    vi.spyOn(ManagedServer.prototype, 'baseUrl').mockReturnValue('http://127.0.0.1:8317')
    const restart = vi.spyOn(ManagedServer.prototype, 'restart')
    const configurationListener = workspace.onDidChangeConfiguration.mock.calls.at(-1)?.[0]

    configurationListener?.({
      affectsConfiguration: section => section === changedSetting,
    })

    await vi.waitFor(() => expect(window.showWarningMessage).toHaveBeenCalledWith(
      'Managed CLIProxyAPI configuration changed. Restart now? Active requests in any VS Code window will be interrupted.',
      'Restart Now',
      'Later',
    ))
    expect(restart).not.toHaveBeenCalled()
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      'Managed CLIProxyAPI configuration changed; it will apply after the next server restart.',
    )
    controller.dispose()
  })

  it('restarts when a managed configuration prompt is accepted', async () => {
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)
    vi.spyOn(ManagedServer.prototype, 'baseUrl').mockReturnValue('http://127.0.0.1:8317')
    const restart = vi.spyOn(ManagedServer.prototype, 'restart').mockResolvedValue({ baseUrl: 'http://127.0.0.1:8317', port: 8317 })
    window.showWarningMessage.mockResolvedValueOnce('Restart Now')
    const configurationListener = workspace.onDidChangeConfiguration.mock.calls.at(-1)?.[0]

    configurationListener?.({ affectsConfiguration: section => section === 'universalChatProvider.server.proxyUrl' })

    await vi.waitFor(() => expect(restart).toHaveBeenCalledWith('proxy configuration changed'))
    controller.dispose()
  })

  it('refreshes models once after restart completes', async () => {
    const restart = vi.spyOn(ManagedServer.prototype, 'restart').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
    const refresh = vi.fn(async () => {})
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setRefreshListener(refresh)
    window.showWarningMessage.mockResolvedValueOnce('Restart')

    await controller.restartServer()
    expect(restart).toHaveBeenCalledWith('manual command')
    expect(refresh).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not restart the shared server without confirmation', async () => {
    const restart = vi.spyOn(ManagedServer.prototype, 'restart')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.restartServer()

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'Restart the shared managed CLIProxyAPI server? Active requests in any VS Code window will be interrupted.',
      { modal: true },
      'Restart',
    )
    expect(restart).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('awaits one model refresh after an account change', async () => {
    let releaseRefresh!: () => void
    const refresh = vi.fn(async () => new Promise<void>(resolve => releaseRefresh = resolve))
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setRefreshListener(refresh)
    const accounts = (controller as unknown as { accounts: { deps: { onAccountsChanged: (expectedModelIds?: readonly string[]) => Promise<void> } } }).accounts

    const expectedModelIds = ['codegate/gpt-5.6-sol']
    const changed = accounts.deps.onAccountsChanged(expectedModelIds)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(expectedModelIds)
    let completed = false
    void changed.then(() => completed = true)
    await Promise.resolve()
    expect(completed).toBe(false)

    releaseRefresh()
    await changed
    expect(completed).toBe(true)
    controller.dispose()
  })

  it('refreshes only the active model provider at most once every three minutes', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-30T12:00:00Z') })
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setQuotaListener(vi.fn())
    vi.spyOn(controller as unknown as { managementForStatus: () => Promise<{ baseUrl: string, key: string }> }, 'managementForStatus')
      .mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', key: 'secret' })
    vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw').mockResolvedValue([
      { name: 'codex.json', provider: 'codex', auth_index: 'c1' },
      { name: 'claude.json', provider: 'claude', auth_index: 'a1' },
    ])
    const apiCall = vi.spyOn(ManagementClient.prototype, 'apiCall').mockResolvedValue({
      statusCode: 200,
      header: {},
      body: JSON.stringify({ rate_limit: {} }),
    })

    controller.scheduleQuotaRefresh({ proxyOwner: 'openai' })
    await vi.waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))
    expect(apiCall.mock.calls[0]?.[0].url).toContain('wham/usage')

    controller.scheduleQuotaRefresh({ proxyOwner: 'openai' })
    await Promise.resolve()
    expect(apiCall).toHaveBeenCalledTimes(1)

    controller.scheduleQuotaRefresh({ proxyOwner: 'anthropic' })
    await vi.waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2))
    expect(apiCall.mock.calls[1]?.[0].url).toContain('oauth/usage')

    await vi.advanceTimersByTimeAsync(180_000)
    controller.scheduleQuotaRefresh({ proxyOwner: 'openai' })
    await vi.waitFor(() => expect(apiCall).toHaveBeenCalledTimes(3))
    controller.dispose()
  })

  it('refreshes all quota providers before a model becomes active', async () => {
    const listener = vi.fn()
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setQuotaListener(listener)
    vi.spyOn(controller as unknown as { managementForStatus: () => Promise<{ baseUrl: string, key: string }> }, 'managementForStatus')
      .mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', key: 'secret' })
    vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw').mockResolvedValue([
      { name: 'codex.json', provider: 'codex', auth_index: 'c1' },
      { name: 'claude.json', provider: 'claude', auth_index: 'a1' },
    ])
    vi.spyOn(ManagementClient.prototype, 'apiCall').mockResolvedValue({
      statusCode: 200,
      header: {},
      body: JSON.stringify({ rate_limit: {} }),
    })

    await controller.refreshQuotas()

    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ provider: 'codex' }),
      expect.objectContaining({ provider: 'claude' }),
    ])
    controller.dispose()
  })

  it('logs restart failures and offers both server log channels', async () => {
    const error = new Error('process ID is unavailable')
    vi.spyOn(ManagedServer.prototype, 'restart').mockRejectedValue(error)
    const { window } = await import('../support/vscode')
    window.showWarningMessage.mockResolvedValueOnce('Restart')
    window.showErrorMessage.mockResolvedValueOnce('Show Server Output')
    const providerOutput = { ...vscodeMock.output, appendLine: vi.fn(), show: vi.fn() }
    const serverOutput = { ...vscodeMock.output, show: vi.fn() }
    const controller = new ServerController(context(root), providerOutput as never, serverOutput as never)

    await controller.restartServer()
    await vi.waitFor(() => expect(serverOutput.show).toHaveBeenCalledWith(true))

    expect(providerOutput.appendLine).toHaveBeenCalledWith('Could not restart CLIProxyAPI: process ID is unavailable')
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Could not restart CLIProxyAPI: process ID is unavailable',
      'Show Logs',
      'Show Server Output',
    )
    expect(await controller.statusSnapshot()).toMatchObject({ status: 'error' })
  })
})

describe('server controller status snapshot', () => {
  let root: string

  beforeEach(async () => {
    resetVSCodeMock()
    root = await makeTempDirectory('ucp-status-')
    vi.spyOn(ManagedServer.prototype, 'ensureRunning').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
    vi.spyOn(ManagedServer.prototype, 'shutdown').mockReturnValue()
    vi.spyOn(ManagedServer.prototype, 'dispose').mockReturnValue()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  it('reports the managed server as running once it has started', async () => {
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)

    const snapshot = await controller.statusSnapshot()

    expect(snapshot).toMatchObject({ mode: 'managed', status: 'running' })
    expect(snapshot.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('reports an unexpected managed server exit', async () => {
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)
    const server = (controller as unknown as { server: ManagedServer }).server
    const onUnexpectedExit = (server as unknown as { deps: { onUnexpectedExit: () => void } }).deps.onUnexpectedExit

    onUnexpectedExit()

    expect(await controller.statusSnapshot()).toMatchObject({ mode: 'managed', status: 'error' })
  })

  it('reports external mode and skips the account probe when no server answers', async () => {
    vscodeMock.settings.set('universalChatProvider.server.mode', 'external')
    vscodeMock.settings.set('universalChatProvider.baseUrl', 'http://127.0.0.1:9')
    vscodeMock.secrets.set('universalChatProvider.managementKey', 'mgmt-secret')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    const snapshot = await controller.statusSnapshot()

    expect(snapshot).toMatchObject({ mode: 'external', status: 'external', baseUrl: 'http://127.0.0.1:9' })
    expect(snapshot.accounts).toBeUndefined()
  })
})

function context(root: string): ExtensionContext {
  return createExtensionContext({ globalStoragePath: root })
}
