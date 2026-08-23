import type { ManagementEndpoint, OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import type { ProxyConnection } from '@src/cliproxy/connection'
import type { ManagedPaths } from '@src/cliproxy/managed/config'
import type { ManagedServer, RestartReason } from '@src/cliproxy/managed/server'
import type { UpdatePolicy } from '@src/cliproxy/managed/update-policy'
import type { CodexResetOption, CodexResetOutcome } from '@src/cliproxy/quota/codex-resets'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import type { ServerMode, ServerStatus, ServerStatusSnapshot } from '@src/cliproxy/status'
import type { Disposable, ExtensionContext, OutputChannel } from 'vscode'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AccountsService } from '@src/cliproxy/accounts/accounts'
import { ManagementClient } from '@src/cliproxy/api/management-client'
import { findConfigPath, normalizeBaseUrl, SECRET_KEY } from '@src/cliproxy/configuration/credentials'
import { readLocalProxyConfig } from '@src/cliproxy/configuration/local-config'
import { resolveVersion } from '@src/cliproxy/managed/binary'
import { MGMT_KEY_SECRET, PORT_STATE_KEY, provisionManagedState, watchCredentialFiles } from '@src/cliproxy/managed/bootstrap'
import { DEFAULT_HOST, DEFAULT_PORT } from '@src/cliproxy/managed/config'
import { releaseLease, withOperationLock } from '@src/cliproxy/managed/leases'
import { LogTailer } from '@src/cliproxy/managed/log-tailer'
import { OpenAICompatibilityStore } from '@src/cliproxy/managed/openai-compatibility-store'
import { maintainRequestLogs } from '@src/cliproxy/managed/request-log-maintenance'
import { pickUpdate } from '@src/cliproxy/managed/update-policy'
import { claimCodexReset, listCodexResets } from '@src/cliproxy/quota/codex-resets'
import { fetchQuotas, quotaProviderForModel } from '@src/cliproxy/quota/quota'
import { countAccounts } from '@src/cliproxy/status'
import { errorMessage } from '@src/shared/errors'
import { debounce } from 'moderndash'
import {
  ConfigurationTarget,
  ProgressLocation,
  window,
  workspace,
} from 'vscode'

export type { ServerMode, ServerStatus, ServerStatusSnapshot } from '@src/cliproxy/status'

const QUOTA_REFRESH_INTERVAL_MS = 180_000

export class ServerController implements ProxyConnection {
  private readonly disposables: Disposable[] = []
  private readonly accounts: AccountsService
  private server: ManagedServer | undefined
  private paths: ManagedPaths | undefined
  private managementKey: string | undefined
  private logTailer: LogTailer | undefined
  private logMaintenanceTimer: NodeJS.Timeout | undefined
  private bootstrapPromise: Promise<void> | undefined
  private readonly scheduleRefresh = debounce(() => void this.notifyAccountsChanged(), 750)
  private refreshListener: ((expectedModelIds?: readonly string[]) => Promise<void>) | undefined
  private statusListener: ((status: ServerStatus) => void) | undefined
  private quotaListener: ((reports: QuotaReport[]) => void) | undefined
  private quotaReports: QuotaReport[] = []
  private activeQuotaProvider: QuotaReport['provider'] | undefined
  private lastQuotaRefresh = new Map<QuotaReport['provider'], number>()
  private quotaBackoff = new Map<string, number>()
  private lastStatus: ServerStatus = 'starting'
  private updateCheckStarted = false

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: OutputChannel,
    private readonly serverOutput: OutputChannel,
  ) {
    const openAICompatibility = new OpenAICompatibilityStore(context.secrets)
    this.accounts = new AccountsService({
      resolveManagement: async start => this.resolveManagement(start),
      currentManagement: () => this.currentManagement(),
      state: context.globalState,
      persistOpenAICompatibility: async (providers: OpenAICompatibilityProvider[]) => this.mode() === 'managed'
        ? openAICompatibility.set(providers)
        : undefined,
      onAccountsChanged: async (expectedModelIds) => {
        await this.notifyAccountsChanged(expectedModelIds)
      },
    })
    this.disposables.push(workspace.onDidChangeConfiguration((event) => {
      const managedConfigChanged = event.affectsConfiguration('universalChatProvider.server.proxyUrl')
        || event.affectsConfiguration('universalChatProvider.debugLevel')
      if (managedConfigChanged && this.mode() === 'managed' && this.server?.baseUrl() !== undefined)
        void this.promptForConfigRestart()
    }))
    this.disposables.push(context.secrets.onDidChange((event) => {
      if (event.key === MGMT_KEY_SECRET)
        void context.secrets.get(MGMT_KEY_SECRET).then(key => this.managementKey = key)
    }))
  }

  mode(): ServerMode {
    return workspace.getConfiguration('universalChatProvider').get<string>('server.mode', 'managed') === 'external'
      ? 'external'
      : 'managed'
  }

  baseUrl(): string {
    if (this.mode() === 'external')
      return normalizeBaseUrl(workspace.getConfiguration('universalChatProvider').get<string>('baseUrl', `http://${DEFAULT_HOST}:${DEFAULT_PORT}`))
    return this.server?.baseUrl()
      ?? `http://${DEFAULT_HOST}:${this.context.globalState.get<number>(PORT_STATE_KEY) ?? DEFAULT_PORT}`
  }

  async acquireRequest(): Promise<() => void> {
    if (this.mode() === 'external')
      return () => {}
    await this.bootstrap()
    const release = await this.server!.acquireRequest()
    return () => {
      release()
      void this.applyPendingUpdateWhenIdle()
    }
  }

  async statusSnapshot(): Promise<ServerStatusSnapshot> {
    const mode = this.mode()
    const version = this.server?.installedVersion()
    const accounts = await countAccounts(await this.managementForStatus())
    return {
      mode,
      status: mode === 'external' ? 'external' : this.lastStatus,
      baseUrl: this.baseUrl(),
      ...(version !== undefined ? { version } : {}),
      ...(accounts !== undefined ? { accounts } : {}),
    }
  }

  async ensureReady(_interactive: boolean): Promise<void> {
    if (this.mode() === 'external') {
      this.setStatus('external')
      return
    }
    const alreadyUp = this.server?.baseUrl() !== undefined
    try {
      if (!alreadyUp)
        this.setStatus('starting')
      await this.bootstrap()
      await this.server!.ensureRunning()
      this.setStatus('running')
      void this.accounts.maybePromptLogin()
      void this.applyPendingUpdateWhenIdle()
      void this.maybeUpdateOnStartup()
    }
    catch (error) {
      this.setStatus('error')
      this.surfaceStartupError(error)
    }
  }

  setRefreshListener(listener: (expectedModelIds?: readonly string[]) => Promise<void>): void {
    this.refreshListener = listener
  }

  setStatusListener(listener: (status: ServerStatus) => void): void {
    this.statusListener = listener
  }

  setQuotaListener(listener: (reports: QuotaReport[]) => void): void {
    this.quotaListener = listener
  }

  scheduleQuotaRefresh(model: { proxyOwner: string }): void {
    this.activeQuotaProvider = quotaProviderForModel(model)
    void this.refreshQuotas()
  }

  async login(): Promise<void> {
    return this.accounts.login()
  }

  async manageAccounts(): Promise<void> {
    return this.accounts.manageAccounts()
  }

  async listCodexResets(): Promise<CodexResetOption[]> {
    const management = await this.resolveManagement(false)
    if (management === undefined)
      return []
    return listCodexResets(new ManagementClient(management.baseUrl, management.key))
  }

  async claimCodexReset(option: CodexResetOption, redeemRequestId: string): Promise<CodexResetOutcome> {
    const management = await this.resolveManagement(false)
    if (management === undefined)
      return 'failed'
    const outcome = await claimCodexReset(new ManagementClient(management.baseUrl, management.key), option, redeemRequestId)
    if (outcome !== 'failed')
      await this.refreshQuotas()
    return outcome
  }

  async updateBinary(): Promise<void> {
    if (this.mode() === 'external') {
      void window.showInformationMessage('Binary updates apply only to the managed server.')
      return
    }
    await this.applyBinaryUpdate(this.requestedVersion())
  }

  private async applyBinaryUpdate(version: string): Promise<void> {
    try {
      await this.bootstrap()
      const previous = this.server!.installedVersion()
      let downloaded: string | undefined
      await window.withProgress(
        { location: ProgressLocation.Notification, title: 'Downloading CLIProxyAPI update…' },
        async () => {
          downloaded = await this.server!.downloadBinary(version)
        },
      )
      void window.showInformationMessage(previous === downloaded
        ? `CLIProxyAPI ${downloaded ?? 'binary'} is already running.`
        : `CLIProxyAPI ${downloaded ?? version} downloaded. It will restart automatically when no requests are active.`)
      await this.applyPendingUpdateWhenIdle()
    }
    catch (error) {
      this.surfaceOperationError('update', error)
    }
  }

  private async maybeUpdateOnStartup(): Promise<void> {
    if (this.updateCheckStarted)
      return
    const policy = this.updatePolicy()
    if (this.mode() === 'external' || policy === 'manual')
      return
    const installed = this.server?.installedVersion()
    this.updateCheckStarted = true

    let target: string | null
    try {
      target = pickUpdate(installed, await resolveVersion('latest'))
    }
    catch (error) {
      this.output.appendLine(`CLIProxyAPI update check failed: ${errorMessage(error)}`)
      return
    }
    if (target === null)
      return

    if (policy === 'suggestUpdates') {
      const choice = await window.showInformationMessage(
        `CLIProxyAPI ${target} is available (you're on ${installed ?? 'an unknown version'}).`,
        'Update',
        'Not Now',
      )
      if (choice !== 'Update')
        return
    }
    await this.applyBinaryUpdate(target)
  }

  private async applyPendingUpdateWhenIdle(): Promise<void> {
    try {
      if (await this.server?.restartPendingWhenIdle() === undefined)
        return
      this.setStatus('running')
      void window.showInformationMessage('CLIProxyAPI update applied after active requests finished.')
      await this.notifyAccountsChanged()
    }
    catch (error) {
      this.setStatus('error')
      this.surfaceOperationError('update', error)
    }
  }

  private async promptForConfigRestart(): Promise<void> {
    const choice = await window.showWarningMessage(
      'Managed CLIProxyAPI configuration changed. Restart now? Active requests in any VS Code window will be interrupted.',
      'Restart Now',
      'Later',
    )
    if (choice === 'Restart Now')
      await this.restartServer('proxy configuration changed')
    else
      this.output.appendLine('Managed CLIProxyAPI configuration changed; it will apply after the next server restart.')
  }

  async restartServer(reason: RestartReason = 'manual command'): Promise<void> {
    if (this.mode() === 'external') {
      void window.showInformationMessage('The managed server is not active in external mode.')
      return
    }
    if (reason === 'manual command') {
      const confirm = await window.showWarningMessage(
        'Restart the shared managed CLIProxyAPI server? Active requests in any VS Code window will be interrupted.',
        { modal: true },
        'Restart',
      )
      if (confirm !== 'Restart')
        return
    }
    try {
      await this.bootstrap()
      await this.server!.restart(reason)
      this.setStatus('running')
      void window.showInformationMessage('Managed CLIProxyAPI restarted.')
      await this.notifyAccountsChanged()
    }
    catch (error) {
      this.setStatus('error')
      this.surfaceOperationError('restart', error)
    }
  }

  async resetServer(): Promise<void> {
    const confirm = await window.showWarningMessage(
      'Reset the shared managed CLIProxyAPI server? Active requests in any VS Code window will be interrupted. Generated config and keys are recreated; connected accounts are kept.',
      { modal: true },
      'Reset',
    )
    if (confirm !== 'Reset')
      return
    try {
      await this.server?.stop()
      if (this.paths !== undefined)
        await rm(this.paths.configPath, { force: true })
      await this.context.secrets.delete(SECRET_KEY)
      await this.context.secrets.delete(MGMT_KEY_SECRET)
      this.bootstrapPromise = undefined
      this.accounts.reset()
      this.managementKey = undefined
      await this.ensureReady(true)
    }
    catch (error) {
      this.setStatus('error')
      this.surfaceOperationError('reset', error)
    }
  }

  dispose(): void {
    this.scheduleRefresh.cancel()
    clearInterval(this.logMaintenanceTimer)
    for (const disposable of this.disposables.splice(0))
      disposable.dispose()
    if (this.paths !== undefined && releaseLease(this.paths.leaseDir))
      this.server?.shutdown()
    else
      this.server?.dispose()
  }

  private configuredVersion(): string {
    return workspace.getConfiguration('universalChatProvider').get<string>('server.version', 'latest').trim()
      || 'latest'
  }

  private updatePolicy(): UpdatePolicy {
    const value = workspace.getConfiguration('universalChatProvider').get<string>('server.updatePolicy', 'automatic')
    return value === 'manual' || value === 'suggestUpdates' ? value : 'automatic'
  }

  private requestedVersion(): string {
    return this.updatePolicy() === 'manual' ? this.configuredVersion() : 'latest'
  }

  private configuredProxyUrl(): string | undefined {
    const proxyUrl = workspace.getConfiguration('universalChatProvider').get<string>('server.proxyUrl', '').trim()
    return proxyUrl.length > 0 ? proxyUrl : undefined
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapPromise === undefined) {
      this.bootstrapPromise = this.doBootstrap().catch((error: unknown) => {
        this.bootstrapPromise = undefined
        throw error
      })
    }
    return this.bootstrapPromise
  }

  private async doBootstrap(): Promise<void> {
    const state = await provisionManagedState({
      context: this.context,
      output: this.output,
      requestedVersion: () => this.requestedVersion(),
      proxyUrl: () => this.configuredProxyUrl(),
      inspectServer: async baseUrl => this.inspectServer(baseUrl),
      onUnexpectedExit: () => this.setStatus('error'),
    })
    this.paths = state.paths
    this.server = state.server
    this.managementKey = state.managementKey
    this.disposables.push(...watchCredentialFiles(state.paths.authDir, () => this.scheduleRefresh()))
    this.startLogMaintenance(join(state.paths.authDir, 'logs'), join(state.paths.root, 'log-maintenance.lock'))
    if (this.logTailer === undefined) {
      this.logTailer = new LogTailer(state.paths.logPath, this.serverOutput).start()
      this.disposables.push(this.logTailer)
    }
  }

  private startLogMaintenance(logDir: string, lockPath: string): void {
    if (this.logMaintenanceTimer !== undefined)
      return
    const run = async (): Promise<void> => {
      try {
        await withOperationLock(lockPath, async () => maintainRequestLogs(logDir))
      }
      catch (error) {
        this.output.appendLine(`Request log maintenance failed: ${errorMessage(error)}`)
      }
    }
    void run()
    this.logMaintenanceTimer = setInterval(() => void run(), 60 * 60 * 1000)
  }

  private async inspectServer(baseUrl: string): Promise<string | undefined | false> {
    if (this.managementKey === undefined)
      return false
    try {
      return await new ManagementClient(baseUrl, this.managementKey).serverVersion()
    }
    catch {
      return false
    }
  }

  private async notifyAccountsChanged(expectedModelIds?: readonly string[]): Promise<void> {
    await this.refreshListener?.(expectedModelIds)
  }

  async refreshQuotas(): Promise<void> {
    const provider = this.activeQuotaProvider
    if (this.quotaListener === undefined)
      return
    if (provider !== undefined) {
      const lastRefresh = this.lastQuotaRefresh.get(provider)
      if (lastRefresh !== undefined && Date.now() - lastRefresh < QUOTA_REFRESH_INTERVAL_MS)
        return
      // Claimed before awaiting so a concurrent call is gated by the same window.
      this.lastQuotaRefresh.set(provider, Date.now())
    }
    return this.performQuotaRefresh(provider)
  }

  private async performQuotaRefresh(provider: QuotaReport['provider'] | undefined): Promise<void> {
    const management = await this.managementForStatus()
    if (management === undefined) {
      if (provider !== undefined)
        this.lastQuotaRefresh.delete(provider)
      return
    }
    try {
      const reports = await fetchQuotas(
        new ManagementClient(management.baseUrl, management.key),
        undefined,
        this.quotaBackoff,
        provider,
      )
      for (const report of reports) {
        if (report.error !== undefined)
          this.output.appendLine(`Quota fetch failed for ${report.provider}${report.account === undefined ? '' : ` (${report.account.label})`}: ${report.error}`)
      }
      this.quotaReports = provider === undefined
        ? reports
        : [...this.quotaReports.filter(report => report.provider !== provider), ...reports]
      this.quotaListener?.(this.quotaReports)
    }
    catch (error) {
      this.output.appendLine(`Quota refresh failed: ${errorMessage(error)}`)
    }
  }

  private async resolveManagement(start: boolean): Promise<ManagementEndpoint | undefined> {
    if (this.mode() === 'managed') {
      if (start) {
        await this.ensureReady(true)
      }
      else {
        try {
          await this.bootstrap()
          await this.server!.ensureRunning()
        }
        catch {}
      }
      const endpoint = this.currentManagement()
      if (endpoint === undefined) {
        void window.showWarningMessage('The managed CLIProxyAPI server is not ready yet. Try again in a moment.')
        return undefined
      }
      return endpoint
    }

    const key = await this.externalManagementKey()
    if (key === undefined) {
      void window.showWarningMessage(
        'To manage accounts on your own server, set remote-management.secret-key (plaintext) in its config.yaml.',
      )
      return undefined
    }
    return { baseUrl: this.baseUrl(), key }
  }

  private currentManagement(): ManagementEndpoint | undefined {
    const baseUrl = this.server?.baseUrl()
    if (baseUrl === undefined || this.managementKey === undefined)
      return undefined
    return { baseUrl, key: this.managementKey }
  }

  private async externalManagementKey(): Promise<string | undefined> {
    const override = await this.context.secrets.get(MGMT_KEY_SECRET)
    if (override !== undefined && override.length > 0)
      return override
    const configPath = await findConfigPath()
    if (configPath === undefined)
      return undefined
    try {
      return (await readLocalProxyConfig(configPath)).managementKey
    }
    catch {
      return undefined
    }
  }

  private setStatus(status: ServerStatus): void {
    this.lastStatus = status
    this.statusListener?.(status)
  }

  private async managementForStatus(): Promise<ManagementEndpoint | undefined> {
    if (this.mode() === 'external') {
      const key = await this.externalManagementKey()
      return key === undefined ? undefined : { baseUrl: this.baseUrl(), key }
    }
    return this.currentManagement()
  }

  private surfaceStartupError(error: unknown): void {
    this.output.appendLine(`Managed CLIProxyAPI failed to start: ${errorMessage(error)}`)
    void window.showWarningMessage(
      `CLIProxyAPI could not start: ${errorMessage(error)}`,
      'Retry',
      'Show Logs',
      'Show Server Output',
      'Use External Server',
    ).then(async (choice) => {
      if (choice === 'Retry')
        await this.ensureReady(true)
      else if (choice === 'Show Logs')
        this.output.show(true)
      else if (choice === 'Show Server Output')
        this.serverOutput.show(true)
      else if (choice === 'Use External Server')
        await workspace.getConfiguration('universalChatProvider').update('server.mode', 'external', ConfigurationTarget.Global)
    })
  }

  private surfaceOperationError(operation: 'restart' | 'reset' | 'update', error: unknown): void {
    const message = `Could not ${operation} CLIProxyAPI: ${errorMessage(error)}`
    this.output.appendLine(message)
    void window.showErrorMessage(message, 'Show Logs', 'Show Server Output').then((choice) => {
      if (choice === 'Show Logs')
        this.output.show(true)
      else if (choice === 'Show Server Output')
        this.serverOutput.show(true)
    })
  }
}
