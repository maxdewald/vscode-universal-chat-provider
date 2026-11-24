import type { ManagementClient } from '@src/cliproxy/api/management-client'
import { errorMessage } from '@src/shared/errors'

// With force-model-prefix, a provider-named prefix keeps retries among one provider's accounts.
export async function pinAccountsToProviders(
  client: ManagementClient,
  log: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of await client.listAuthFilesRaw(signal)) {
    const provider = (file.provider ?? file.type ?? '').trim().toLowerCase()
    const name = file.name
    // Plugin models stay unprefixed: CLIProxyAPI cannot route a prefixed id to a plugin executor.
    if (name === undefined || provider === '' || provider === 'agy')
      continue
    const models = await client.listAuthFileModels(name, signal).catch(() => [])
    // An account that already has a prefix, ours or the user's, keeps it.
    if (models.every(id => id.includes('/')))
      continue
    try {
      await client.setAuthFilePrefix(name, provider, signal)
      log(`Pinned ${provider} account ${name} to its own provider.`)
    }
    catch (error) {
      log(`Could not pin ${provider} account ${name}: ${errorMessage(error)}`)
    }
  }
}
