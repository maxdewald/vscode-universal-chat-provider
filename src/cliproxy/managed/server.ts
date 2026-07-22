import type { ChildProcess } from 'node:child_process'
import type { OutputChannel } from 'vscode'
import type { ManagedPaths } from './config'
import { spawn } from 'node:child_process'
import { closeSync, openSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import getPort from 'get-port'
import ky from 'ky'
import { sleep } from 'moderndash'
import { acquireBinary, readInstalledVersion } from './binary'
import { DEFAULT_PORT } from './config'
import { readServerPid, removeServerPid, withOperationLock, writeServerPid } from './leases'

const HEALTH_TIMEOUT_MS = 1500
const STARTUP_TIMEOUT_MS = 20_000
const STARTUP_POLL_MS = 300

export interface ServerDeps {
  paths: ManagedPaths
  output: OutputChannel
  host: string
  requestedVersion: () => string
  getPort: () => number | undefined
  setPort: (port: number) => void | Thenable<void>
  writeConfig: (port: number) => Promise<void>
  inspectServer?: (baseUrl: string) => Promise<string | undefined | false>
  onUnexpectedExit?: () => void
}

export interface RunningServer {
  baseUrl: string
  port: number
  version?: string
}

export class ManagedServer {
  private child: ChildProcess | undefined
  private adopted = false
  private port: number | undefined
  private version: string | undefined
  private startPromise: Promise<RunningServer> | undefined

  constructor(private readonly deps: ServerDeps) {}

  baseUrl(): string | undefined {
    return this.port === undefined ? undefined : `http://${this.deps.host}:${this.port}`
  }

  installedVersion(): string | undefined {
    return this.version
  }

  async ensureRunning(signal?: AbortSignal): Promise<RunningServer> {
    if (this.startPromise !== undefined)
      return this.startPromise
    if (this.port !== undefined && (this.adopted || (this.child !== undefined && this.child.exitCode === null)))
      return { baseUrl: this.baseUrl()!, port: this.port, ...(this.version !== undefined ? { version: this.version } : {}) }

    this.startPromise = withOperationLock(this.deps.paths.operationLockPath, async () => this.start(signal)).finally(() => {
      this.startPromise = undefined
    })
    return this.startPromise
  }

  async restart(signal?: AbortSignal, requestedVersion?: string): Promise<RunningServer> {
    const starting = this.startPromise
    if (starting !== undefined) {
      try {
        await starting
      }
      catch {}
    }
    const version = requestedVersion ?? this.version ?? await readInstalledVersion(this.deps.paths.binDir)
    this.startPromise = withOperationLock(this.deps.paths.operationLockPath, async () => {
      await this.stopUnlocked()
      return this.start(signal, version ?? this.deps.requestedVersion())
    }).finally(() => {
      this.startPromise = undefined
    })
    return this.startPromise
  }

  async stop(): Promise<void> {
    await withOperationLock(this.deps.paths.operationLockPath, async () => this.stopUnlocked())
  }

  private async stopUnlocked(): Promise<void> {
    const child = this.child
    const adopted = this.adopted
    const port = this.port
    this.child = undefined
    this.adopted = false
    this.port = undefined
    if (child !== undefined && child.exitCode === null) {
      child.kill()
      if (port !== undefined)
        await waitForStop(this.deps.host, port)
      if (child.pid !== undefined)
        removeServerPid(this.deps.paths.pidPath, child.pid)
      this.deps.output.appendLine('Stopped the managed CLIProxyAPI server.')
    }
    else if (adopted) {
      const pid = readServerPid(this.deps.paths.pidPath)
      if (pid === undefined)
        throw new Error('Could not restart the shared CLIProxyAPI server because its process ID is unavailable.')
      try {
        process.kill(pid)
      }
      catch (error) {
        throw new Error(`Could not stop the shared CLIProxyAPI server: ${(error as Error).message}`)
      }
      if (port !== undefined)
        await waitForStop(this.deps.host, port)
      removeServerPid(this.deps.paths.pidPath, pid)
      this.deps.output.appendLine('Stopped the shared managed CLIProxyAPI server.')
    }
  }

  dispose(): void {
    this.child?.removeAllListeners()
    this.child = undefined
  }

  shutdown(): void {
    const child = this.child
    this.child = undefined
    this.adopted = false
    this.port = undefined
    if (child !== undefined && child.exitCode === null) {
      child.kill()
    }
    else {
      const pid = readServerPid(this.deps.paths.pidPath)
      if (pid !== undefined) {
        try {
          process.kill(pid)
        }
        catch {}
      }
    }
    rmSync(this.deps.paths.pidPath, { force: true })
  }

  private async start(signal?: AbortSignal, requestedVersion: string = this.deps.requestedVersion()): Promise<RunningServer> {
    const preferred = this.deps.getPort() ?? DEFAULT_PORT
    const preferredBase = `http://${this.deps.host}:${preferred}`
    if (await isHealthy(this.deps.host, preferred, signal)) {
      const inspected = this.deps.inspectServer === undefined ? undefined : await this.deps.inspectServer(preferredBase)
      if (inspected !== false) {
        this.adopted = true
        this.port = preferred
        this.version = inspected ?? await readInstalledVersion(this.deps.paths.binDir)
        await this.deps.writeConfig(preferred)
        this.deps.output.appendLine(`Adopted a healthy CLIProxyAPI server on port ${preferred}.`)
        return { baseUrl: preferredBase, port: preferred, ...(this.version !== undefined ? { version: this.version } : {}) }
      }
      this.deps.output.appendLine(`Port ${preferred} is held by another CLIProxyAPI; starting a separate managed server.`)
    }

    const { binaryPath, version } = await acquireBinary({
      binDir: this.deps.paths.binDir,
      requestedVersion,
      output: this.deps.output,
      ...(signal ? { signal } : {}),
    })
    this.version = version

    const port = await getPort({ port: preferred, host: this.deps.host })
    await this.spawnServer(binaryPath, port)
    await waitForHealthz(this.deps.host, port, signal)
    this.adopted = false
    this.port = port
    await this.deps.setPort(port)
    this.deps.output.appendLine(`CLIProxyAPI ${version} is running on port ${port}.`)
    return { baseUrl: this.baseUrl()!, port, version }
  }

  private async spawnServer(binaryPath: string, port: number): Promise<void> {
    await mkdir(this.deps.paths.authDir, { recursive: true })
    await this.deps.writeConfig(port)
    const logFd = openSync(this.deps.paths.logPath, 'a')
    try {
      const child = spawn(binaryPath, ['--config', this.deps.paths.configPath], {
        cwd: this.deps.paths.root,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      })
      this.child = child
      if (child.pid !== undefined)
        writeServerPid(this.deps.paths.pidPath, child.pid)
      child.unref()
      child.on('exit', (code, sig) => {
        if (this.child === child) {
          this.child = undefined
          this.port = undefined
          this.deps.output.appendLine(`CLIProxyAPI exited unexpectedly (code=${code ?? 'null'}, signal=${sig ?? 'null'}); it will restart on next use.`)
          this.deps.onUnexpectedExit?.()
        }
      })
      child.on('error', (error) => {
        this.deps.output.appendLine(`CLIProxyAPI process error on port ${port}: ${error.message}`)
      })
    }
    finally {
      closeSync(logFd)
    }
  }
}

async function isHealthy(host: string, port: number, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await ky.get(`http://${host}:${port}/healthz`, {
      timeout: HEALTH_TIMEOUT_MS,
      retry: 0,
      throwHttpErrors: false,
      signal: signal ?? null,
    })
    return response.ok
  }
  catch {
    return false
  }
}

async function waitForHealthz(host: string, port: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted)
      throw new Error('Cancelled while waiting for CLIProxyAPI to start.')
    if (await isHealthy(host, port, signal))
      return
    await sleep(STARTUP_POLL_MS)
  }
  throw new Error(`CLIProxyAPI did not become healthy on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s.`)
}

async function waitForStop(host: string, port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await isHealthy(host, port)))
      return
    await sleep(STARTUP_POLL_MS)
  }
  throw new Error(`CLIProxyAPI did not stop on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s.`)
}
