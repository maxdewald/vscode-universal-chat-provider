import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
