import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { sleep } from 'moderndash'

const OPERATION_LOCK_TIMEOUT_MS = 20_000
const OPERATION_LOCK_POLL_MS = 100

export function claimLease(leaseDir: string, id: number = process.pid): void {
  mkdirSync(leaseDir, { recursive: true })
  writeFileSync(join(leaseDir, String(id)), '')
}

export function releaseLease(leaseDir: string, id: number = process.pid): boolean {
  rmSync(join(leaseDir, String(id)), { force: true })
  let names: string[]
  try {
    names = readdirSync(leaseDir)
  }
  catch {
    return true
  }
  let live = 0
  for (const name of names) {
    const pid = Number(name)
    if (Number.isInteger(pid) && isAlive(pid))
      live++
    else
      rmSync(join(leaseDir, name), { force: true })
  }
  return live === 0
}

export function writeServerPid(pidPath: string, pid: number): void {
  writeFileSync(pidPath, String(pid))
}

export function readServerPid(pidPath: string): number | undefined {
  try {
    const pid = Number(readFileSync(pidPath, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  }
  catch {
    return undefined
  }
}

export function removeServerPid(pidPath: string, pid: number): void {
  if (readServerPid(pidPath) === pid)
    rmSync(pidPath, { force: true })
}

export async function withOperationLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  const owner = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + OPERATION_LOCK_TIMEOUT_MS
  while (!(await tryClaimOperationLock(lockPath, owner))) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for another CLIProxyAPI operation to finish.')
    await sleep(OPERATION_LOCK_POLL_MS)
  }
  try {
    return await operation()
  }
  finally {
    if (await readFile(lockPath, 'utf8').catch(() => undefined) === owner)
      await rm(lockPath, { force: true })
  }
}

async function tryClaimOperationLock(lockPath: string, owner: string): Promise<boolean> {
  const candidatePath = `${lockPath}.${randomUUID()}.candidate`
  try {
    await writeFile(candidatePath, owner)
    await link(candidatePath, lockPath)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      throw error
  }
  finally {
    await rm(candidatePath, { force: true })
  }

  const currentOwner = await readFile(lockPath, 'utf8').catch(() => undefined)
  const ownerPid = Number(currentOwner?.split(':', 1)[0])
  if (Number.isInteger(ownerPid) && isAlive(ownerPid))
    return false
  try {
    const stalePath = `${lockPath}.stale-${randomUUID()}`
    await rename(lockPath, stalePath)
    await rm(stalePath, { force: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  return false
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
