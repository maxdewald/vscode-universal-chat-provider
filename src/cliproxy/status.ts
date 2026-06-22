import type { ManagementEndpoint } from './management-client'
import { ManagementClient } from './management-client'

const STATUS_PROBE_TIMEOUT_MS = 1500

export type ServerMode = 'managed' | 'external'
export type ServerStatus = 'external' | 'starting' | 'running' | 'error'

export interface ServerStatusSnapshot {
  mode: ServerMode
  status: ServerStatus
  baseUrl: string
  version?: string
  accounts?: number
}

export interface StatusInputs {
  mode: ServerMode
  lastStatus: ServerStatus
  baseUrl: string
  version: string | undefined
  management: ManagementEndpoint | undefined
}

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
