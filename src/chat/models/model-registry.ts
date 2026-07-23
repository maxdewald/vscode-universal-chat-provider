import type { CancellationToken, Event, OutputChannel } from 'vscode'
import type { CredentialStore } from '../../cliproxy/configuration/credentials'
import type { ProxyConnection } from '../../cliproxy/connection'
import type { ProviderModel } from './model'
import { sleep } from 'moderndash'
import { EventEmitter, window } from 'vscode'
import { isProxyCredentialRejection } from '../../cliproxy/api/errors'
import { CLIProxyClient } from '../../cliproxy/api/proxy-client'
import { errorMessage } from '../../shared/errors'
import { fetchCatalog } from './catalog'
import { mapProxyModels } from './model'

export interface ModelRegistryHooks {
  acquireApiKey: () => Promise<string | undefined>
  onCredentialsRejected: () => void
  onCredentialsAccepted: () => void
}

const REFRESH_TTL_MS = 15_000
const MODEL_READY_POLL_MS = 50
const MODEL_READY_TIMEOUT_MS = 5_000

export class ModelRegistry {
  private readonly changeEmitter = new EventEmitter<void>()
  private cachedModels: ProviderModel[] = []
  private cachedFingerprint = ''
  private previousCollisions = new Set<string>()
  private lastRefreshAt = 0
  private refreshPromise: Promise<ProviderModel[]> | undefined
  private thinkingEnrichmentDone = false

  readonly onDidChange: Event<void> = this.changeEmitter.event

  constructor(
    private readonly connection: ProxyConnection,
    private readonly credentials: CredentialStore,
    private readonly output: OutputChannel,
    private readonly hooks: ModelRegistryHooks,
  ) {}

  dispose(): void {
    this.changeEmitter.dispose()
  }

  snapshot(): ProviderModel[] {
    return this.cachedModels
  }

  reset(): void {
    this.cachedModels = []
    this.cachedFingerprint = ''
    this.previousCollisions.clear()
    this.lastRefreshAt = 0
    this.thinkingEnrichmentDone = false
    this.changeEmitter.fire()
  }

  async refresh(interactive: boolean, token?: CancellationToken): Promise<ProviderModel[]> {
    if (this.refreshPromise !== undefined)
      return this.refreshPromise
    if (Date.now() - this.lastRefreshAt < REFRESH_TTL_MS)
      return this.cachedModels

    this.refreshPromise = this.discoverModels(interactive, token).finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  async forceRefresh(interactive = true, expectedProxyModelIds: readonly string[] = []): Promise<ProviderModel[]> {
    const expected = new Set(expectedProxyModelIds)
    const deadline = Date.now() + MODEL_READY_TIMEOUT_MS
    while (true) {
      const models = await this.refreshNow(interactive)
      const missing = [...expected].filter(id => !models.some(model => model.proxyModelId === id))
      if (missing.length === 0)
        return models
      if (Date.now() >= deadline) {
        this.output.appendLine(`Timed out waiting for CLIProxyAPI models: ${missing.join(', ')}.`)
        return models
      }
      interactive = false
      await sleep(MODEL_READY_POLL_MS)
    }
  }

  private async refreshNow(interactive: boolean): Promise<ProviderModel[]> {
    if (this.refreshPromise !== undefined)
      await this.refreshPromise
    this.lastRefreshAt = 0
    return this.refresh(interactive)
  }

  private async discoverModels(interactive: boolean, token?: CancellationToken): Promise<ProviderModel[]> {
    await this.connection.ensureReady(interactive)
    let apiKey = await this.credentials.get()
    if (apiKey === undefined && interactive)
      apiKey = await this.hooks.acquireApiKey()
    if (apiKey === undefined)
      return []

    const controller = new AbortController()
    const cancellation = token?.onCancellationRequested(() => controller.abort())
    try {
      const client = new CLIProxyClient(this.connection.baseUrl(), apiKey)
      const catalog = await fetchCatalog(controller.signal)
      if (!this.thinkingEnrichmentDone && this.connection.enrichOpenAICompatibilityThinking) {
        this.thinkingEnrichmentDone = true
        if (await this.connection.enrichOpenAICompatibilityThinking(catalog))
          this.output.appendLine('Enriched OpenAI-compatible thinking levels from the model catalog.')
      }
      const discovery = await client.discover(controller.signal)
      const collisions = new Set<string>()
      const models = mapProxyModels(discovery.available, discovery.metadata, catalog, {
        onSkipped: (id, reason) => this.output.appendLine(`Skipped model ${id}: ${reason}.`),
        onCollision: message => collisions.add(message),
      })
      for (const collision of collisions) {
        if (!this.previousCollisions.has(collision))
          this.output.appendLine(collision)
      }
      this.previousCollisions = collisions
      const fingerprint = JSON.stringify(models)
      if (fingerprint !== this.cachedFingerprint) {
        const countChanged = models.length !== this.cachedModels.length
        this.cachedFingerprint = fingerprint
        this.cachedModels = models
        this.changeEmitter.fire()
        if (countChanged)
          this.output.appendLine(`Discovered ${models.length} CLIProxyAPI chat models at ${this.connection.baseUrl()}.`)
      }
      this.lastRefreshAt = Date.now()
      this.hooks.onCredentialsAccepted()
      return this.cachedModels
    }
    catch (error) {
      this.output.appendLine(`Model discovery failed: ${errorMessage(error)}`)
      if (isProxyCredentialRejection(error))
        this.hooks.onCredentialsRejected()
      else if (interactive)
        void window.showErrorMessage(`CLIProxyAPI model discovery failed: ${errorMessage(error)}`)
      return this.cachedModels
    }
    finally {
      cancellation?.dispose()
    }
  }
}
