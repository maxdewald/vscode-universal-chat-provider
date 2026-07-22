import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

export function useTempDirectories(): (prefix: string) => Promise<string> {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(async path => rm(path, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })))
  })

  return async (prefix: string) => {
    const directory = await mkdtemp(join(tmpdir(), prefix))
    directories.push(directory)
    return directory
  }
}
