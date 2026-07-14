import type { ChildProcess } from 'node:child_process'
import type { OutputChannel } from 'vscode'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedPaths } from '../../../src/cliproxy/managed/config'
import { ManagedServer } from '../../../src/cliproxy/managed/server'

describe('managed server lifecycle', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ucp-server-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
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

  function createServer(): ManagedServer {
    return new ManagedServer({
      paths: managedPaths(root),
      output: { appendLine: vi.fn() } as unknown as OutputChannel,
      host: '127.0.0.1',
      requestedVersion: () => '7.2.5',
      getPort: () => undefined,
      setPort: vi.fn(),
    })
  }
})
