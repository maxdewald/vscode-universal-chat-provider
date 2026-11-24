import type { ManagementClient } from '@src/cliproxy/api/management-client'
import type { OutputChannel } from 'vscode'
import { rm } from 'node:fs/promises'
import process from 'node:process'
import { agyAccountHome, installAgyPlugin, markAgySignIn } from '@src/cliproxy/managed/antigravity-plugin'
import { errorMessage } from '@src/shared/errors'
import { sleep } from 'moderndash'
import { ProgressLocation, window } from 'vscode'

export const AGY = 'agy'

// The managed server's storage and config; undefined when the user runs their own server.
export interface ManagedServerAccess {
  root: string
  authDir: string
  rewriteConfig: () => Promise<void>
}

export interface AntigravityDeps {
  managed: () => ManagedServerAccess | undefined
  onAccountsChanged: () => Promise<void>
  output: OutputChannel
}

// Antigravity accounts go through the cliproxy-antigravity plugin, which runs only while it has an account or a sign-in.
export class AntigravityAccounts {
  private legacyWarned = false

  constructor(private readonly deps: AntigravityDeps) {}

  async signIn(client: ManagementClient, startSignIn: () => Promise<void>): Promise<void> {
    try {
      const before = new Set((await client.listAuthFilesRaw()).map(file => file.name))
      await window.withProgress(
        { location: ProgressLocation.Notification, title: 'Setting up Antigravity…' },
        async () => this.loadPlugin(client),
      )
      // On first use the plugin imports an agy login that already exists in the user's HOME.
      const imported = (await client.listAuthFilesRaw()).some(file => (file.provider ?? file.type) === AGY && !before.has(file.name))
      if (imported) {
        await this.deps.onAccountsChanged()
        void window.showInformationMessage('Antigravity account connected from your existing agy sign-in.')
        return
      }
      if (process.platform === 'win32') {
        void window.showWarningMessage('On Windows, sign in by running agy in a terminal, then add the Antigravity account again.')
        return
      }
      await startSignIn()
    }
    catch (error) {
      void window.showErrorMessage(`Could not set up Antigravity: ${errorMessage(error)}`)
    }
    finally {
      const managed = this.deps.managed()
      if (managed !== undefined) {
        await markAgySignIn(managed.root, false).catch(() => undefined)
        await managed.rewriteConfig().catch(() => undefined)
      }
    }
  }

  // Deletes the account's agy home too, or the plugin imports the still signed-in home again.
  async removeAccount(client: ManagementClient, name: string): Promise<void> {
    const managed = this.deps.managed()
    const home = managed === undefined ? undefined : await agyAccountHome(managed.root, managed.authDir, name)
    await client.deleteAuthFile(name)
    if (home !== undefined)
      await rm(home, { recursive: true, force: true })
  }

  // Accounts signed in through the built-in Antigravity OAuth risk being blocked by Google.
  async maybeWarnLegacy(client: ManagementClient, signInAgain: () => Promise<void>): Promise<void> {
    if (this.legacyWarned)
      return
    const legacy = (await client.listAuthFilesRaw().catch(() => []))
      .filter(file => (file.provider ?? file.type) === 'antigravity' && file.name !== undefined)
    if (legacy.length === 0)
      return
    this.legacyWarned = true
    const choice = await window.showWarningMessage(
      `${legacy.length === 1 ? 'Your Antigravity account is' : `${legacy.length} Antigravity accounts are`} connected the old way, which Google may block. Remove and sign in again through the Antigravity CLI.`,
      'Remove and Sign In Again',
      'Later',
    )
    if (choice !== 'Remove and Sign In Again')
      return
    try {
      for (const file of legacy)
        await client.deleteAuthFile(file.name!)
      await this.deps.onAccountsChanged()
    }
    catch (error) {
      void window.showErrorMessage(`Could not remove the old Antigravity accounts: ${errorMessage(error)}`)
      return
    }
    await signInAgain()
  }

  private async loadPlugin(client: ManagementClient): Promise<void> {
    const managed = this.deps.managed()
    if (managed === undefined)
      return
    await installAgyPlugin(managed.root, this.deps.output)
    await markAgySignIn(managed.root, true)
    await managed.rewriteConfig()
    // The server hot-reloads plugin changes from its config file.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await client.isPluginRegistered('cliproxy-antigravity').catch(() => false))
        return
      await sleep(250)
    }
    throw new Error('CLIProxyAPI did not load the Antigravity plugin. Check Show Server Output.')
  }
}

// Accepts the code Google shows or the full callback URL, and returns a URL CLIProxyAPI can parse.
export function agyCallbackUrl(input: string, state: string): string | undefined {
  const value = input.trim()
  const url = URL.parse(value)
  if (url !== null)
    return url.searchParams.get('state') === state && (url.searchParams.get('code') ?? '') !== '' ? url.href : undefined
  if (value === '' || /\s/.test(value))
    return undefined
  const callback = new URL('https://antigravity.google/oauth-callback')
  callback.searchParams.set('code', value)
  callback.searchParams.set('state', state)
  return callback.href
}
