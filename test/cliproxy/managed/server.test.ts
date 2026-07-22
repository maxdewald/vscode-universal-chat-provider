import type { ChildProcess } from 'node:child_process'
import type { OutputChannel } from 'vscode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedPaths } from '../../../src/cliproxy/managed/config'
import { ManagedServer } from '../../../src/cliproxy/managed/server'
import { useTempDirectories } from '../../support/temp'

const makeTempDirectory = useTempDirectories()

describe('managed server lifecycle', () => {
  let root: string

  beforeEach(async () => {
    root = await makeTempDirectory('ucp-server-')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('recreates the config when restarting the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const writeConfig = vi.fn()
    const appendLine = vi.fn()
    const server = createServer({
      output: { appendLine } as unknown as OutputChannel,
      getPort: () => 8317,
      writeConfig,
      inspectServer: async () => '7.2.5',
    })

    await server.restart('manual command')

    expect(appendLine).toHaveBeenCalledWith('Restarting managed CLIProxyAPI (reason: manual command).')
    expect(writeConfig).toHaveBeenCalledOnce()
    expect(writeConfig).toHaveBeenCalledWith(8317)
  })

  it('retries a restart twice before succeeding', async () => {
    const appendLine = vi.fn()
    const server = createServer({ output: { appendLine } as unknown as OutputChannel })
    const start = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValue({ baseUrl: 'http://127.0.0.1:8317', port: 8317 })
    Object.assign(server, { start })

    await expect(server.restart('manual command')).resolves.toMatchObject({ port: 8317 })

    expect(start).toHaveBeenCalledTimes(3)
    expect(appendLine).toHaveBeenCalledWith('Managed CLIProxyAPI restart attempt 1 failed: first failure Retrying.')
    expect(appendLine).toHaveBeenCalledWith('Managed CLIProxyAPI restart attempt 2 failed: second failure Retrying.')
  })

  it('fails a restart after two retries', async () => {
    const server = createServer()
    const error = new Error('still unavailable')
    const start = vi.fn().mockRejectedValue(error)
    Object.assign(server, { start })

    await expect(server.restart('manual command')).rejects.toBe(error)

    expect(start).toHaveBeenCalledTimes(3)
  })

  it('waits for an owned child to stop answering before completing stop', async () => {
    let healthy = true
    vi.stubGlobal('fetch', vi.fn(async () => healthy
      ? new Response(null, { status: 200 })
      : Promise.reject(new Error('connection refused'))))
    const kill = vi.fn(() => {
      setTimeout(() => {
        healthy = false
      }, 50)
      return true
    })
    const server = createServer()
    Object.assign(server, {
      child: { exitCode: null, kill } as unknown as ChildProcess,
      port: 8317,
    })

    const stopping = server.stop()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(kill).toHaveBeenCalledOnce()
    await expect(Promise.race([
      stopping.then(() => 'stopped'),
      Promise.resolve('waiting'),
    ])).resolves.toBe('waiting')
    await stopping
  })

  function createServer(overrides: Partial<ConstructorParameters<typeof ManagedServer>[0]> = {}): ManagedServer {
    return new ManagedServer({
      paths: managedPaths(root),
      output: { appendLine: vi.fn() } as unknown as OutputChannel,
      host: '127.0.0.1',
      requestedVersion: () => '7.2.5',
      getPort: () => undefined,
      setPort: vi.fn(),
      writeConfig: vi.fn(),
      ...overrides,
    })
  }
})
