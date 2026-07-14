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

export async function countAccounts(management: ManagementEndpoint | undefined): Promise<number | undefined> {
  if (management === undefined)
    return undefined
  try {
    const files = await new ManagementClient(management.baseUrl, management.key)
      .listAuthFiles(AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS))
    return files.length
  }
  catch {
    return undefined
  }
}
