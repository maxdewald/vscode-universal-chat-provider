import type { CancellationToken } from 'vscode'
import type { StreamCallbacks } from '../cliproxy/client'
import type { ProxyConnection } from '../cliproxy/connection'
import type { CredentialStore } from '../cliproxy/credentials'
import { LanguageModelError } from 'vscode'
import { CLIProxyClient } from '../cliproxy/client'
import { ProxyHttpError } from '../cliproxy/errors'

export interface CompletionDeps {
  connection: ProxyConnection
  credentials: CredentialStore
  onCredentialsRejected: () => void
}

/** A cancelled request resolves quietly (without throwing) so callers can treat it as a no-op. */
export async function streamCompletion(
  deps: CompletionDeps,
  body: Record<string, unknown>,
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
    if (error instanceof ProxyHttpError && (error.status === 401 || error.status === 403))
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
