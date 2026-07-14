import type { ChildProcess } from 'node:child_process'
import type { ExtensionContext } from 'vscode'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerController } from '../../src/cliproxy/controller'
import { managedPaths } from '../../src/cliproxy/managed/config'
import { claimLease } from '../../src/cliproxy/managed/leases'
import { ManagedServer } from '../../src/cliproxy/managed/server'
import { resetVSCodeMock, vscodeMock } from '../support/vscode'

describe('server controller lifecycle', () => {
  let root: string
  const spawned: ChildProcess[] = []

  beforeEach(async () => {
    resetVSCodeMock()
    root = await mkdtemp(join(tmpdir(), 'ucp-controller-'))
    vi.spyOn(ManagedServer.prototype, 'ensureRunning').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
  })

  afterEach(async () => {
    for (const child of spawned.splice(0))
      child.kill()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
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

    claimLease(managedPaths(root).leaseDir, liveProcess().pid)

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

  function liveProcess(): ChildProcess {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' })
    spawned.push(child)
    return child
  }
})

describe('server controller status snapshot', () => {
  let root: string

  beforeEach(async () => {
    resetVSCodeMock()
    root = await mkdtemp(join(tmpdir(), 'ucp-status-'))
    vi.spyOn(ManagedServer.prototype, 'ensureRunning').mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', port: 1 })
    vi.spyOn(ManagedServer.prototype, 'shutdown').mockReturnValue()
    vi.spyOn(ManagedServer.prototype, 'dispose').mockReturnValue()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
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
  const globalState = new Map<string, unknown>()
  return {
    subscriptions: [],
    globalStorageUri: { fsPath: root },
    globalState: {
      get: <T>(key: string, fallback?: T): T => (globalState.get(key) ?? fallback) as T,
      update: async (key: string, value: unknown) => {
        globalState.set(key, value)
      },
    },
    secrets: {
      get: async (key: string) => vscodeMock.secrets.get(key),
      store: async (key: string, value: string) => {
        vscodeMock.secrets.set(key, value)
      },
      delete: async (key: string) => {
        vscodeMock.secrets.delete(key)
      },
      onDidChange: () => ({ dispose() {} }),
    },
  } as unknown as ExtensionContext
}
