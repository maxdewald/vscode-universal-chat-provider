import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Reference-counts the VS Code windows that share the managed sidecar. Each
 * window drops a lease file named after its process id; the sidecar is only
 * stopped once the last live lease is released, so a shared server is never
 * killed out from under another open window and no orphan is left running when
 * the final window closes.
 */
export function claimLease(leaseDir: string, id: number = process.pid): void {
  mkdirSync(leaseDir, { recursive: true })
  writeFileSync(join(leaseDir, String(id)), '')
}

/**
 * Release this window's lease and report whether it was the last one. Leases
 * owned by a process that no longer exists (a crashed window) are pruned and
 * do not count, so a crash can never permanently pin the sidecar alive.
 */
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

/** True when a process with this id exists. Signal 0 probes without killing. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    // ESRCH means the process is gone; EPERM means it exists but is not ours.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
