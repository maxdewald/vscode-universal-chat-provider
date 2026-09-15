import type { ModelRegistry } from '@src/chat/models/model-registry'
import type { CredentialStore } from '@src/cliproxy/configuration/credentials'
import { configureConnection } from '@src/cliproxy/configuration/credentials'
import { window } from 'vscode'

export class CredentialFlows {
  private onboardingShown = false
  private credentialRecoveryShown = false

  constructor(
    private readonly credentials: CredentialStore,
    private readonly registry: ModelRegistry,
  ) {}

  markCredentialsAccepted(): void {
    this.credentialRecoveryShown = false
  }

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
    await this.registry.forceRefresh(true)
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

    const choice = await window.showInformationMessage(
      'CLIProxyAPI setup is incomplete. Configure a connection to load local models.',
      'Configure Connection',
    )
    if (choice === 'Configure Connection')
      await this.configure()
  }

  async showCredentialRecovery(): Promise<void> {
    if (this.credentialRecoveryShown)
      return
    this.credentialRecoveryShown = true
    const choice = await window.showWarningMessage(
      'CLIProxyAPI rejected the stored API key. Enter a new API key or configure the connection.',
      'Enter API Key',
      'Configure',
    )
    if (choice === 'Enter API Key') {
      if (await this.credentials.prompt() === undefined)
        return
      this.markCredentialsAccepted()
      await this.registry.forceRefresh(false)
    }
    else if (choice === 'Configure') {
      await this.configure()
    }
  }
}
