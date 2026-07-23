import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claimLease, readServerPid, releaseLease, removeServerPid, withOperationLock, writeServerPid } from '@src/cliproxy/managed/leases'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChildProcesses, waitForExit } from '../../support/process'
import { useTempDirectories } from '../../support/temp'

const makeTempDirectory = useTempDirectories()
const { spawnPersistentNodeProcess } = useChildProcesses()

describe('window leases', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeTempDirectory('ucp-lease-')
  })

  it('reports the releasing window as last when no one else holds a lease', () => {
    claimLease(dir, process.pid)
    expect(releaseLease(dir, process.pid)).toBe(true)
  })

  it('keeps the sidecar alive while another live window holds a lease', () => {
    const other = spawnPersistentNodeProcess()
    claimLease(dir, process.pid)
    claimLease(dir, other.pid)

    expect(releaseLease(dir, process.pid)).toBe(false)
  })

  it('prunes a crashed window’s lease and counts it as gone', async () => {
    const crashed = spawnPersistentNodeProcess()
    const crashedPid = crashed.pid!
    crashed.kill()
    await waitForExit(crashed)
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

  it('removes a server pid only when it still belongs to that process', () => {
    const pidPath = join(dir, 'server.pid')
    writeServerPid(pidPath, 4321)

    removeServerPid(pidPath, 1234)
    expect(readServerPid(pidPath)).toBe(4321)

    removeServerPid(pidPath, 4321)
    expect(readServerPid(pidPath)).toBeUndefined()
  })

  it('serializes operations that share a lock path', async () => {
    const lockPath = join(dir, 'operation.lock')
    let releaseFirst!: () => void
    const first = withOperationLock(lockPath, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      return 'first'
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    let secondStarted = false
    const second = withOperationLock(lockPath, async () => {
      secondStarted = true
      return 'second'
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(secondStarted).toBe(false)
    releaseFirst()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('recovers an operation lock left by a dead process', async () => {
    const lockPath = join(dir, 'operation.lock')
    await writeFile(lockPath, '999999999:stale-owner')

    await expect(withOperationLock(lockPath, async () => 'recovered')).resolves.toBe('recovered')
  })
})
