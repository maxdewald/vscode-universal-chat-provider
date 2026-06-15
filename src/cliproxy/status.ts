import type { ManagementEndpoint } from './management-client'
import { ManagementClient } from './management-client'

const STATUS_PROBE_TIMEOUT_MS = 1500

export type ServerMode = 'managed' | 'external'
export type ServerStatus = 'external' | 'starting' | 'running' | 'error'

/** A point-in-time view of the proxy for the manage picker's status entry. */
export interface ServerStatusSnapshot {
  mode: ServerMode
  status: ServerStatus
  baseUrl: string
  /** Managed binary version, when this window spawned it (absent when adopted). */
  version?: string
  /** Connected provider accounts, when the server could be reached. */
  accounts?: number
}

export interface StatusInputs {
  mode: ServerMode
  lastStatus: ServerStatus
  baseUrl: string
  version: string | undefined
  /** Endpoint for the best-effort account probe, when one is already known. */
  management: ManagementEndpoint | undefined
}

/**
 * Assemble the manage picker's status row. Cheap by design: it reports the given
 * last status rather than re-probing health, and only the account count touches
 * the network (best-effort, never starting the server).
 */
export async function buildStatusSnapshot(inputs: StatusInputs): Promise<ServerStatusSnapshot> {
  const snapshot: ServerStatusSnapshot = {
    mode: inputs.mode,
    status: inputs.mode === 'external' ? 'external' : inputs.lastStatus,
    baseUrl: inputs.baseUrl,
    ...(inputs.version !== undefined ? { version: inputs.version } : {}),
  }
  const accounts = await countAccounts(inputs.management)
  return accounts === undefined ? snapshot : { ...snapshot, accounts }
}

/**
 * Best-effort count of connected accounts for the status row. Returns undefined
 * whenever the server is unreachable or no endpoint is known.
 */
async function countAccounts(management: ManagementEndpoint | undefined): Promise<number | undefined> {
  if (management === undefined)
    return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STATUS_PROBE_TIMEOUT_MS)
  try {
    const files = await new ManagementClient(management.baseUrl, management.key).listAuthFiles(controller.signal)
    return files.length
  }
  catch {
    return undefined
  }
  finally {
    clearTimeout(timer)
  }
}
