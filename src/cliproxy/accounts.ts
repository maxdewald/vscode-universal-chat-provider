import type { ManagementEndpoint } from './management-client'
import { env, ProgressLocation, Uri, window } from 'vscode'
import { delay } from '../shared/async'
import { errorMessage } from '../shared/errors'
import { LOGIN_PROVIDERS, ManagementClient } from './management-client'

const LOGIN_TIMEOUT_MS = 180_000
const LOGIN_POLL_MS = 1500

export interface AccountsDeps {
  /** Resolve a management endpoint, optionally starting the managed server. */
  resolveManagement: (start: boolean) => Promise<ManagementEndpoint | undefined>
  /** The live managed endpoint when one is already running (no side effects). */
  currentManagement: () => ManagementEndpoint | undefined
  /** Notify that the connected-account set may have changed. */
  onAccountsChanged: () => void
}

/** The provider OAuth login and account-management UI flows. */
export class AccountsService {
  private loginPrompted = false

  constructor(private readonly deps: AccountsDeps) {}

  /** Allow the "no accounts connected" prompt to appear again (after a reset). */
  reset(): void {
    this.loginPrompted = false
  }

  /** Open the provider OAuth login flow against whichever server is active. */
  async login(): Promise<void> {
    const management = await this.deps.resolveManagement(true)
    if (management === undefined)
      return

    const picked = await window.showQuickPick(
      LOGIN_PROVIDERS.map(provider => ({ label: provider.label, detail: provider.detail, provider })),
      { title: 'Connect a CLIProxyAPI Account', placeHolder: 'Choose a provider to sign in with' },
    )
    if (picked === undefined)
      return

    const client = new ManagementClient(management.baseUrl, management.key)
    let url: string
    let before: number
    try {
      before = (await client.listAuthFiles()).length
      url = (await client.requestAuthUrl(picked.provider.endpoint)).url
    }
    catch (error) {
      void window.showErrorMessage(`Could not start ${picked.provider.label} login: ${errorMessage(error)}`)
      return
    }

    const opened = await env.openExternal(Uri.parse(url))
    if (!opened) {
      void window.showWarningMessage(`Open this URL to finish signing in: ${url}`)
      return
    }

    const connected = await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: true, title: `Waiting for ${picked.provider.label} sign-in…` },
      async (_progress, token) => {
        const deadline = Date.now() + LOGIN_TIMEOUT_MS
        while (Date.now() < deadline && !token.isCancellationRequested) {
          await delay(LOGIN_POLL_MS)
          const files = await client.listAuthFiles().catch(() => [])
          if (files.length > before)
            return true
        }
        return false
      },
    )

    if (connected) {
      void window.showInformationMessage(`${picked.provider.label} account connected.`)
      this.deps.onAccountsChanged()
    }
    else {
      void window.showWarningMessage(`${picked.provider.label} sign-in did not complete. Check Show Logs and try again.`)
    }
  }

  /** List connected accounts and optionally remove one. */
  async manageAccounts(): Promise<void> {
    const management = await this.deps.resolveManagement(false)
    if (management === undefined)
      return
    const client = new ManagementClient(management.baseUrl, management.key)
    const files = await client.listAuthFiles().catch((error): undefined => {
      void window.showErrorMessage(`Could not list accounts: ${errorMessage(error)}`)
      return undefined
    })
    if (files === undefined)
      return
    if (files.length === 0) {
      const choice = await window.showInformationMessage('No accounts are connected.', 'Add Account')
      if (choice === 'Add Account')
        await this.login()
      return
    }

    const picked = await window.showQuickPick(
      files.map(file => ({ label: file.name, ...(file.type !== undefined ? { description: file.type } : {}) })),
      { title: 'Connected Accounts', placeHolder: 'Select an account to remove' },
    )
    if (picked === undefined)
      return
    const confirm = await window.showWarningMessage(`Remove the account ${picked.label}?`, { modal: true }, 'Remove')
    if (confirm !== 'Remove')
      return
    try {
      await client.deleteAuthFile(picked.label)
      void window.showInformationMessage(`Removed ${picked.label}.`)
      this.deps.onAccountsChanged()
    }
    catch (error) {
      void window.showErrorMessage(`Could not remove ${picked.label}: ${errorMessage(error)}`)
    }
  }

  /** After startup, prompt once to connect an account when none exist yet. */
  async maybePromptLogin(): Promise<void> {
    if (this.loginPrompted)
      return
    const management = this.deps.currentManagement()
    if (management === undefined)
      return
    this.loginPrompted = true
    try {
      const client = new ManagementClient(management.baseUrl, management.key)
      if ((await client.listAuthFiles()).length > 0)
        return
      const choice = await window.showInformationMessage(
        'CLIProxyAPI is running but no model accounts are connected yet.',
        'Add Account',
        'Later',
      )
      if (choice === 'Add Account')
        await this.login()
    }
    catch {}
  }
}
