import { normalizeVersion } from '@src/cliproxy/managed/binary'
import semver from 'semver'

export type UpdatePolicy = 'automatic' | 'suggestUpdates' | 'manual'

export const MAX_MANAGED_VERSION = '7.2.115'
export const MAX_MANAGED_VERSION_REASON = 'CLIProxyAPI 7.2.116 and later stop advancing Claude prompt caches for requests translated from the OpenAI Responses endpoint (router-for-me/CLIProxyAPI#4855).'

export function pickUpdate(installed: string | undefined, latest: string): string | null {
  const latestVersion = semver.valid(normalizeVersion(latest))
  if (latestVersion === null)
    return null
  const target = semver.gt(latestVersion, MAX_MANAGED_VERSION) ? MAX_MANAGED_VERSION : latestVersion
  if (installed === undefined)
    return target
  const current = semver.valid(normalizeVersion(installed))
  if (current === null)
    return null
  return semver.gt(target, current) || semver.gt(current, MAX_MANAGED_VERSION) ? target : null
}
