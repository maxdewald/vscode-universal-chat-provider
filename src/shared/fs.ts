import { access } from 'node:fs/promises'

/** True when the path is accessible (exists and is reachable). */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}
