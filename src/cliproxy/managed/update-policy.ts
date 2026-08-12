import { normalizeVersion } from '@src/cliproxy/managed/binary'
import semver from 'semver'

export type UpdatePolicy = 'automatic' | 'suggestUpdates' | 'manual'

export function pickUpdate(installed: string | undefined, latest: string, maximum?: string): string | null {
  const latestVersion = semver.valid(normalizeVersion(latest))
  if (latestVersion === null)
    return null
  const target = maximum !== undefined && semver.gt(latestVersion, maximum) ? maximum : latestVersion
  if (installed === undefined)
    return target
  const current = semver.valid(normalizeVersion(installed))
  if (current === null)
    return null
  return semver.gt(target, current) || (maximum !== undefined && semver.gt(current, maximum)) ? target : null
}
