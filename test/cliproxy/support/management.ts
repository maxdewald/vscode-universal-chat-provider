import type { AuthFileRaw, ManagementClient } from '@src/cliproxy/api/management-client'
import { UpstreamError } from '@src/cliproxy/api/management-client'
import { vi } from 'vitest'

export interface ManagementApiResponse {
  statusCode: number
  body: unknown
  header?: Record<string, string[]>
}

type CallAsRequest = Parameters<ManagementClient['callAs']>[1]
type ApiCallResponder = (
  url: string,
  request: CallAsRequest,
  signal?: AbortSignal,
) => ManagementApiResponse | Promise<ManagementApiResponse>

export function createManagementClientFake(
  authFiles: AuthFileRaw[],
  respond: ApiCallResponder,
): {
  client: ManagementClient
  callAs: ReturnType<typeof vi.fn<ManagementClient['callAs']>>
} {
  const callAs = vi.fn<ManagementClient['callAs']>(async (_authIndex, request, signal) => {
    const { statusCode, body, header } = await respond(request.url, request, signal)
    if (statusCode < 200 || statusCode >= 300)
      throw new UpstreamError(statusCode, header ?? {}, typeof body === 'string' ? body : JSON.stringify(body))
    return body
  })
  return {
    client: {
      listAuthFilesRaw: vi.fn(async () => authFiles),
      callAs,
    } as unknown as ManagementClient,
    callAs,
  }
}

export function queuedApiCallResponses(responses: ManagementApiResponse[]): ApiCallResponder {
  const queue = [...responses]
  return async () => queue.shift() ?? { statusCode: 500, body: '' }
}
