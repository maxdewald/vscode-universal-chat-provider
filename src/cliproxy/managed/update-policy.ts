import { normalizeVersion } from '@src/cliproxy/managed/binary'
import semver from 'semver'

export type UpdatePolicy = 'automatic' | 'suggestUpdates' | 'manual'

export function pickUpdate(installed: string | undefined, latest: string): string | null {
  const latestVersion = semver.valid(normalizeVersion(latest))
  if (latestVersion === null)
    return null
  if (installed === undefined)
    return latestVersion
  const current = semver.valid(normalizeVersion(installed))
  if (current === null)
    return null
  return semver.gt(latestVersion, current) ? latestVersion : null
}
