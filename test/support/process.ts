import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { afterEach } from 'vitest'

export function useChildProcesses(): { spawnPersistentNodeProcess: () => ChildProcess } {
  const children: ChildProcess[] = []

  afterEach(async () => {
    await Promise.all(children.splice(0).map(async (child) => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill()
      await waitForExit(child)
    }))
  })

  return {
    spawnPersistentNodeProcess() {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' })
      children.push(child)
      return child
    },
  }
}

export async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
}
