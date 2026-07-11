import semver from 'semver'
import { normalizeVersion, resolveVersion } from './binary'

export type UpdatePolicy = 'automatic' | 'suggestUpdates' | 'manual'

export function pickUpdate(installed: string | undefined, latest: string): string | null {
  if (installed === undefined)
    return normalizeVersion(latest)
  const current = semver.valid(normalizeVersion(installed))
  const target = semver.valid(normalizeVersion(latest))
  if (current === null || target === null)
    return null
  return semver.gt(target, current) ? target : null
}

export async function latestReleaseVersion(signal?: AbortSignal): Promise<string> {
  return resolveVersion('latest', signal)
}
