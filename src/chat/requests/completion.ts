import type { CancellationToken } from 'vscode'
import type { StreamCallbacks } from '../../cliproxy/api/proxy-client'
import type { CredentialStore } from '../../cliproxy/configuration/credentials'
import type { ProxyConnection } from '../../cliproxy/connection'
import type { ProxyRequestBody } from './request-builder'
import { LanguageModelError } from 'vscode'
import { isProxyCredentialRejection, ProxyHttpError } from '../../cliproxy/api/errors'
import { CLIProxyClient } from '../../cliproxy/api/proxy-client'

export interface CompletionDeps {
  connection: ProxyConnection
  credentials: CredentialStore
  onCredentialsRejected: () => void
}

export async function streamCompletion(
  deps: CompletionDeps,
  body: ProxyRequestBody,
  callbacks: StreamCallbacks,
  token?: CancellationToken,
): Promise<void> {
  await deps.connection.ensureReady(false)
  const apiKey = await deps.credentials.get()
  if (apiKey === undefined)
    throw LanguageModelError.NoPermissions('Configure a CLIProxyAPI API key first.')

  const controller = new AbortController()
  const cancellation = token?.onCancellationRequested(() => controller.abort())
  const client = new CLIProxyClient(deps.connection.baseUrl(), apiKey)

  try {
    await client.streamResponse(body, callbacks, controller.signal)
  }
  catch (error) {
    if (token?.isCancellationRequested)
      return
    if (isProxyCredentialRejection(error))
      deps.onCredentialsRejected()
    throw mapProviderError(error)
  }
  finally {
    cancellation?.dispose()
  }
}

function mapProviderError(error: unknown): Error {
  if (error instanceof ProxyHttpError) {
    if (error.status === 401 || error.status === 403)
      return LanguageModelError.NoPermissions(error.message)
    if (error.status === 404)
      return LanguageModelError.NotFound(error.message)
    if (error.status === 429)
      return LanguageModelError.Blocked(error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}
