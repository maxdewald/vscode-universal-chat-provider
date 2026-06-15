import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimLease, readServerPid, releaseLease, writeServerPid } from '../../../src/cliproxy/managed/leases'

describe('window leases', () => {
  let dir: string
  const spawned: ChildProcess[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ucp-lease-'))
  })

  afterEach(async () => {
    for (const child of spawned.splice(0))
      child.kill()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the releasing window as last when no one else holds a lease', () => {
    claimLease(dir, process.pid)
    expect(releaseLease(dir, process.pid)).toBe(true)
  })

  it('keeps the sidecar alive while another live window holds a lease', () => {
    const other = liveProcess()
    claimLease(dir, process.pid)
    claimLease(dir, other.pid)

    expect(releaseLease(dir, process.pid)).toBe(false)
  })

  it('prunes a crashed window’s lease and counts it as gone', async () => {
    const crashed = liveProcess()
    const crashedPid = crashed.pid!
    crashed.kill()
    await onExit(crashed)
    claimLease(dir, process.pid)
    claimLease(dir, crashedPid)

    expect(releaseLease(dir, process.pid)).toBe(true)
    expect(await readdir(dir)).not.toContain(String(crashedPid))
  })

  it('round-trips the server pid and ignores a missing or garbage file', async () => {
    const pidPath = join(dir, 'server.pid')
    expect(readServerPid(pidPath)).toBeUndefined()

    writeServerPid(pidPath, 4321)
    expect(readServerPid(pidPath)).toBe(4321)

    await writeFile(pidPath, 'not-a-pid')
    expect(readServerPid(pidPath)).toBeUndefined()
  })

  function liveProcess(): ChildProcess {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' })
    spawned.push(child)
    return child
  }
})

async function onExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
}
