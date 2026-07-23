import type { ManagementEndpoint } from './api/management-client'
import { ManagementClient } from './api/management-client'

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
    const client = new ManagementClient(management.baseUrl, management.key)
    const signal = AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS)
    const [files, endpoints] = await Promise.all([
      client.listAuthFiles(signal),
      client.listOpenAICompatibility(signal).catch(() => []),
    ])
    return files.length + endpoints.length
  }
  catch {
    return undefined
  }
}
