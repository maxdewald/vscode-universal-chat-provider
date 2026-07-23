import type { AuthFileRaw, ManagementClient } from '../../../src/cliproxy/api/management-client'
import { vi } from 'vitest'

export interface ManagementApiResponse {
  statusCode: number
  body: unknown
  header?: Record<string, string[]>
}

type ApiCallPayload = Parameters<ManagementClient['apiCall']>[0]
type ApiCallResponder = (
  url: string,
  payload: ApiCallPayload,
  signal?: AbortSignal,
) => ManagementApiResponse | Promise<ManagementApiResponse>

export function createManagementClientFake(
  authFiles: AuthFileRaw[],
  respond: ApiCallResponder,
): {
  client: ManagementClient
  apiCall: ReturnType<typeof vi.fn<ManagementClient['apiCall']>>
} {
  const apiCall = vi.fn<ManagementClient['apiCall']>(async (payload, signal) => ({
    header: {},
    ...await respond(payload.url, payload, signal),
  }))
  return {
    client: {
      listAuthFilesRaw: vi.fn(async () => authFiles),
      apiCall,
    } as unknown as ManagementClient,
    apiCall,
  }
}

export function queuedApiCallResponses(responses: ManagementApiResponse[]): ApiCallResponder {
  const queue = [...responses]
  return async () => queue.shift() ?? { statusCode: 500, body: '' }
}
