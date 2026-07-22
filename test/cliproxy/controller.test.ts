import type { ExtensionContext } from 'vscode'
import { readdir, readFile } from 'node:fs/promises'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { ServerController } from '../../src/cliproxy/controller'
import { managedPaths } from '../../src/cliproxy/managed/config'
import { claimLease } from '../../src/cliproxy/managed/leases'
import { OPENAI_COMPATIBILITY_SECRET } from '../../src/cliproxy/managed/openai-compatibility-store'
import { ManagedServer } from '../../src/cliproxy/managed/server'
import { useChildProcesses } from '../support/process'
import { useTempDirectories } from '../support/temp'
import { createExtensionContext, resetVSCodeMock, vscodeMock, workspace } from '../support/vscode'

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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tag_name: 'v8.0.0' })))
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.ensureReady(false)
    await vi.waitFor(() => {
      expect(vscodeMock.output.appendLine).not.toHaveBeenCalledWith(expect.stringContaining('update check failed'))
      expect(vscodeMock.settings.get('universalChatProvider.server.updatePolicy')).toBe('suggestUpdates')
    })

    const { window } = await import('../support/vscode')
    await vi.waitFor(() => expect(window.showInformationMessage).toHaveBeenCalledWith(
      'CLIProxyAPI 8.0.0 is available (you\'re on 7.2.5).',
      'Update',
      'Not Now',
    ))
  })

  it('logs binary updates as restarts with the configured version', async () => {
    vscodeMock.settings.set('universalChatProvider.server.version', '8.0.0')
    const restart = vi.spyOn(ManagedServer.prototype, 'restart').mockResolvedValue({ baseUrl: 'http://127.0.0.1:8317', port: 8317, version: '8.0.0' })
    vi.spyOn(ManagedServer.prototype, 'installedVersion').mockReturnValue('7.2.5')
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)

    await controller.updateBinary()

    expect(restart).toHaveBeenCalledWith('binary update', undefined, '8.0.0')
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

  it('restarts the managed server when the proxy setting changes', async () => {
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    await controller.ensureReady(false)
    vi.spyOn(ManagedServer.prototype, 'baseUrl').mockReturnValue('http://127.0.0.1:8317')
    const restart = vi.spyOn(ManagedServer.prototype, 'restart').mockResolvedValue({ baseUrl: 'http://127.0.0.1:8317', port: 8317 })
    const configurationListener = workspace.onDidChangeConfiguration.mock.calls.at(-1)?.[0]

    configurationListener?.({
      affectsConfiguration: section => section === 'universalChatProvider.server.proxyUrl',
    })

    await vi.waitFor(() => expect(restart).toHaveBeenCalledWith('proxy configuration changed'))
    controller.dispose()
  })

  it('refreshes models twice while registration settles after restart', async () => {
    vi.useFakeTimers()
    const restart = vi.spyOn(ManagedServer.prototype, 'restart').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
    const refresh = vi.fn()
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setRefreshListener(refresh)

    await controller.restartServer()
    expect(restart).toHaveBeenCalledWith('manual command')
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(750)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_249)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('refreshes models again after an account change settles', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const controller = new ServerController(context(root), vscodeMock.output as never, vscodeMock.output as never)
    controller.setRefreshListener(refresh)
    const accounts = (controller as unknown as { accounts: { deps: { onAccountsChanged: () => void } } }).accounts

    accounts.deps.onAccountsChanged()
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('logs restart failures and offers both server log channels', async () => {
    const error = new Error('process ID is unavailable')
    vi.spyOn(ManagedServer.prototype, 'restart').mockRejectedValue(error)
    const { window } = await import('../support/vscode')
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
