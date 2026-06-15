import type { OutputChannel } from 'vscode'
import type { CredentialStore } from '../cliproxy/credentials'
import type { LocalProxyConfig } from '../cliproxy/local-config'
import type { ModelRegistry } from './model-registry'
import { window } from 'vscode'
import { configureConnection } from '../cliproxy/credentials'
import { errorMessage } from '../shared/errors'

/**
 * The onboarding, credential-recovery, and import notification flows. These are
 * the interactive paths that obtain or repair the CLIProxyAPI credentials the
 * {@link ModelRegistry} needs, then trigger a refresh once a key is in place.
 */
export class CredentialFlows {
  private onboardingShown = false
  private credentialRecoveryShown = false

  constructor(
    private readonly credentials: CredentialStore,
    private readonly registry: ModelRegistry,
    private readonly output: OutputChannel,
  ) {}

  /** Reset recovery state so a fresh prompt can be shown after a known-good key. */
  markCredentialsAccepted(): void {
    this.credentialRecoveryShown = false
  }

  /** Interactive path used by discovery when no key is stored. */
  async acquireApiKey(): Promise<string | undefined> {
    await this.showOnboarding()
    return this.credentials.get()
  }

  async configure(): Promise<void> {
    if (!await configureConnection())
      return
    if (await this.credentials.get() === undefined && await this.credentials.prompt() === undefined)
      return
    this.markCredentialsAccepted()
    if (!this.registry.isRefreshing())
      await this.registry.forceRefresh(true)
  }

  async importConfig(): Promise<void> {
    await this.importAndRefresh(true)
  }

  async clearCredentials(): Promise<void> {
    await this.credentials.clear()
    this.registry.reset()
    await this.showOnboarding(true)
  }

  async showOnboarding(force = false): Promise<void> {
    if (this.onboardingShown && !force)
      return
    this.onboardingShown = true

    let config: LocalProxyConfig | undefined
    try {
      config = await this.credentials.inspectLocalConfig()
    }
    catch (error) {
      this.output.appendLine(`Could not inspect CLIProxyAPI config: ${errorMessage(error)}`)
    }

    if (config?.apiKey !== undefined) {
      const choice = await window.showInformationMessage(
        'A local CLIProxyAPI config was found. Import its API key to load models?',
        'Import API Key',
        'Configure',
      )
      if (choice === 'Import API Key')
        await this.importAndRefresh(true)
      else if (choice === 'Configure')
        await this.configure()
      return
    }

    const choice = await window.showInformationMessage(
      'CLIProxyAPI setup is incomplete. Configure a connection to load local models.',
      'Configure Connection',
      'Retry',
    )
    if (choice === 'Configure Connection')
      await this.configure()
    else if (choice === 'Retry')
      await this.showOnboarding(true)
  }

  async showCredentialRecovery(): Promise<void> {
    if (this.credentialRecoveryShown)
      return
    this.credentialRecoveryShown = true
    const choice = await window.showWarningMessage(
      'CLIProxyAPI rejected the stored API key. Re-import it from the local config or configure the connection.',
      'Re-import API Key',
      'Configure',
    )
    if (choice === 'Re-import API Key')
      await this.importAndRefresh(false)
    else if (choice === 'Configure')
      await this.configure()
  }

  private async importAndRefresh(showSuccess: boolean): Promise<void> {
    if (await this.credentials.importFromConfig(true) === undefined)
      return

    this.markCredentialsAccepted()
    if (!this.registry.isRefreshing())
      await this.registry.forceRefresh(false)
    if (showSuccess)
      void window.showInformationMessage('CLIProxyAPI API key imported and models refreshed.')
  }
}
