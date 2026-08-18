import type { ProviderModel } from '@src/chat/models/model'
import type { CompletionDeps } from '@src/chat/requests/completion'
import type { ProxyConnection } from '@src/cliproxy/connection'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import type {
  CancellationToken,
  Event,
  ExtensionContext,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  OutputChannel,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode'
import { CredentialFlows } from '@src/chat/credentials/credential-flows'
import { CacheMetricsTracker, createContextUsagePart } from '@src/chat/diagnostics/cache-metrics'
import { ModelRegistry } from '@src/chat/models/model-registry'
import { detectCompaction } from '@src/chat/requests/compaction'
import { streamCompletion } from '@src/chat/requests/completion'
import { estimateTokens } from '@src/chat/requests/estimate'
import { buildRequest } from '@src/chat/requests/request-builder'
import { CredentialStore } from '@src/cliproxy/configuration/credentials'
import { remainingForModel } from '@src/cliproxy/quota/quota'
import { errorMessage } from '@src/shared/errors'
import * as vscode from 'vscode'
import {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from 'vscode'

const UTILITY_EFFORTS_KEY = 'universalChatProvider.utilityReasoningEfforts'
const UCP_PREFIX = 'universal-chat-provider/'

interface HostChatResponseOptions {
  modelConfiguration?: { reasoningEffort?: string }
  requestInitiator?: string
}

// Not yet in the published @types/vscode this project pins; present at runtime in Copilot Chat.
const LanguageModelThinkingPart = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as new (value: string) => LanguageModelResponsePart

export class UniversalChatProvider implements LanguageModelChatProvider<ProviderModel> {
  private readonly credentials: CredentialStore
  private readonly registry: ModelRegistry
  private readonly credentialFlows: CredentialFlows
  private readonly cacheMetrics: CacheMetricsTracker
  private quotaReports: QuotaReport[] = []
  private lastUsedModel: { proxyModelId: string, proxyOwner: string, name: string } | undefined
  onActivity: ((model: { proxyOwner: string }) => void) | undefined

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: OutputChannel,
    private readonly connection: ProxyConnection,
    private readonly onSignIn?: () => Promise<void>,
  ) {
    this.credentials = new CredentialStore(context)
    this.registry = new ModelRegistry(connection, this.credentials, output, {
      acquireApiKey: async () => this.credentialFlows.acquireApiKey(),
      onCredentialsRejected: () => void this.credentialFlows.showCredentialRecovery(),
      onCredentialsAccepted: () => this.credentialFlows.markCredentialsAccepted(),
    })
    this.credentialFlows = new CredentialFlows(this.credentials, this.registry, output)
    this.cacheMetrics = new CacheMetricsTracker(context, output)
  }

  get onDidChangeLanguageModelChatInformation(): Event<void> {
    return this.registry.onDidChange
  }

  setQuotas(reports: QuotaReport[]): void {
    // Claude's usage endpoint intermittently 401s; keep the last good value per account so a
    // transient failure doesn't blank the menu. Other providers always take the fresh report.
    const previousClaude = this.quotaReports.filter(report => report.provider === 'claude')
    this.quotaReports = reports.map((report) => {
      if (report.provider !== 'claude' || hasQuota(report))
        return report
      const previous = previousClaude.find(prev => prev.account?.authIndex === report.account?.authIndex && hasQuota(prev))
      return previous ?? report
    })
  }

  // Remaining quota for the model in the most recent request, or undefined when no model has run
  // yet or its provider exposes no quota. Drives the status-bar low-quota warning.
  currentModelQuota(): { name: string, remainingPercent: number } | undefined {
    if (this.lastUsedModel === undefined)
      return undefined
    const remaining = remainingForModel(this.quotaReports, this.lastUsedModel)
    return remaining === undefined ? undefined : { name: this.lastUsedModel.name, remainingPercent: remaining }
  }

  // Structured quota for the menu: Codex/Claude/Grok as account windows (5h/7d/credits), Antigravity per model.
  quotaSections(): Array<{ title: string, entries: Array<{ name: string, remainingPercent: number | undefined, balance?: { amount: number, currency: string, suffix: 'left' | 'used' }, resetsAt?: number }> }> {
    const sections: Array<{ title: string, entries: Array<{ name: string, remainingPercent: number | undefined, balance?: { amount: number, currency: string, suffix: 'left' | 'used' }, resetsAt?: number }> }> = []
    for (const [provider, title] of [['codex', 'Codex'], ['claude', 'Claude'], ['grok', 'Grok'], ['kimi', 'Kimi']] as const) {
      const reports = this.quotaReports.filter(r => r.provider === provider)
      const multiple = reports.length > 1
      for (const report of reports) {
        sections.push({
          title: multiple && report.account !== undefined ? `${title} (${report.account.label})` : title,
          // An account whose quota has not loaded yet still gets a row, so the menu shows it as pending.
          entries: report.windows.length === 0
            ? [{ name: 'Quota', remainingPercent: undefined }]
            : report.windows.map(window => ({
                name: window.label,
                remainingPercent: window.remainingPercent,
                ...(window.balance === undefined ? {} : { balance: window.balance }),
                ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
              })),
        })
      }
    }

    const antigravity = this.quotaReports.find(report => report.provider === 'antigravity' && report.error === undefined)
    const models = antigravity?.models
    if (models !== undefined) {
      const entries = this.registry.snapshot()
        .filter(model => model.proxyOwner.toLowerCase() === 'antigravity' && models[model.proxyModelId] !== undefined)
        .map((model) => {
          const quota = models[model.proxyModelId]!
          return { name: model.name, remainingPercent: quota.remainingPercent, ...(quota.resetsAt === undefined ? {} : { resetsAt: quota.resetsAt }) }
        })
        .sort((a, b) => (a.remainingPercent ?? 101) - (b.remainingPercent ?? 101))
      if (entries.length > 0)
        sections.push({ title: 'Antigravity', entries })
    }
    return sections
  }

  dispose(): void {
    this.registry.dispose()
    this.cacheMetrics.dispose()
  }

  async initialize(): Promise<void> {
    await this.connection.ensureReady(false)
    if (await this.credentials.get() === undefined) {
      await this.credentialFlows.showOnboarding()
      return
    }
    await this.registry.forceRefresh(false)
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
  ): Promise<ProviderModel[]> {
    if (token.isCancellationRequested)
      return []
    // Interactive resolve (silent:false) only happens when the user picks us in "Add Models",
    // so open the account login flow first; the refresh then shows whatever they connected.
    if (!options.silent && this.onSignIn !== undefined) {
      await this.onSignIn()
      return this.registry.forceRefresh(false)
    }
    return this.registry.refresh(!options.silent, token)
  }

  async provideLanguageModelChatResponse(
    model: ProviderModel,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    // Host-only fields used by Copilot Chat; not in the public ProvideLanguageModelChatResponseOptions type.
    const requestOptions = options as HostChatResponseOptions
    const compaction = detectCompaction(messages)
    const targetModel = compaction === 'separate' ? this.compactionModel(model) : model
    this.lastUsedModel = { proxyModelId: targetModel.proxyModelId, proxyOwner: targetModel.proxyOwner, name: targetModel.name }
    const chosenEffort = compaction !== undefined
      // Compaction is prose over a transcript-sized prompt, so the lowest level is what makes it fast.
      ? targetModel.reasoningLevels[0]
      : requestOptions.requestInitiator === 'core'
        ? this.utilityEffort(targetModel) ?? requestOptions.modelConfiguration?.reasoningEffort ?? targetModel.reasoningEffort
        : requestOptions.modelConfiguration?.reasoningEffort ?? targetModel.reasoningEffort
    const request = await buildRequest(targetModel, messages, options, { reasoningEffort: chosenEffort, omitTools: compaction !== undefined })
    const recordUsage = this.cacheMetrics.start({
      model: targetModel.proxyModelId,
      promptCacheKey: request.prompt_cache_key,
      reasoningEffort: request.reasoning?.effort,
      inputItems: request.input,
    })
    try {
      await streamCompletion(
        this.completionDeps(),
        request,
        {
          onText: (delta) => {
            progress.report(new LanguageModelTextPart(delta))
          },
          onThinking: (delta) => {
            progress.report(new LanguageModelThinkingPart(delta))
          },
          onToolCall: (callId, name, input) =>
            progress.report(new LanguageModelToolCallPart(callId, name, input)),
          onUsage: (usage) => {
            recordUsage(usage)
            const part = createContextUsagePart(usage)
            if (part !== undefined)
              progress.report(part)
          },
        },
        token,
      )
    }
    catch (error) {
      const utilityTask = compaction !== undefined
        ? 'compaction'
        : requestOptions.requestInitiator === 'core' ? 'utility' : undefined
      if (utilityTask !== undefined) {
        const effort = request.reasoning?.effort
        this.output.appendLine(
          `[utility] failed task=${utilityTask} model=${targetModel.proxyModelId}`
          + `${effort === undefined ? '' : ` effort=${effort}`} error=${errorMessage(error)}`,
        )
      }
      throw error
    }
    finally {
      this.onActivity?.(targetModel)
    }
  }

  async provideTokenCount(
    _model: ProviderModel,
    value: string | LanguageModelChatRequestMessage,
    token: CancellationToken,
  ): Promise<number> {
    if (token.isCancellationRequested)
      return 0
    return estimateTokens(value)
  }

  async getModels(interactive: boolean, token?: CancellationToken): Promise<readonly ProviderModel[]> {
    return this.registry.refresh(interactive, token)
  }

  async forceRefresh(interactive = true, expectedProxyModelIds: readonly string[] = []): Promise<ProviderModel[]> {
    return this.registry.forceRefresh(interactive, expectedProxyModelIds)
  }

  getUtilityEffort(modelId: string): string | undefined {
    return this.context.globalState.get<Record<string, string>>(UTILITY_EFFORTS_KEY, {})[modelId]
  }

  private utilityEffort(model: ProviderModel): string | undefined {
    const stored = this.getUtilityEffort(model.id)
    return stored !== undefined && model.reasoningLevels.includes(stored) ? stored : model.reasoningLevels[0]
  }

  async updateUtilityEffort(modelId: string, effort: string | undefined): Promise<void> {
    const next = { ...this.context.globalState.get<Record<string, string>>(UTILITY_EFFORTS_KEY, {}) }
    if (effort === undefined)
      delete next[modelId]
    else
      next[modelId] = effort
    await this.context.globalState.update(UTILITY_EFFORTS_KEY, next)
  }

  async configure(): Promise<void> {
    return this.credentialFlows.configure()
  }

  async importConfig(): Promise<void> {
    return this.credentialFlows.importConfig()
  }

  async clearCredentials(): Promise<void> {
    return this.credentialFlows.clearCredentials()
  }

  // Falls back to the current model, which still gets the lowest reasoning level and no tools.
  private compactionModel(current: ProviderModel): ProviderModel {
    const configured = vscode.workspace.getConfiguration('chat').get<string>('utilityModel', '').trim()
    if (!configured.startsWith(UCP_PREFIX))
      return current
    const utility = this.registry.snapshot().find(candidate => candidate.id === configured.slice(UCP_PREFIX.length))
    return utility !== undefined && utility.maxInputTokens >= current.maxInputTokens ? utility : current
  }

  private completionDeps(): CompletionDeps {
    return {
      connection: this.connection,
      credentials: this.credentials,
      onCredentialsRejected: () => void this.credentialFlows.showCredentialRecovery(),
    }
  }
}

function hasQuota(report: QuotaReport): boolean {
  return report.error === undefined && (report.windows.length > 0 || Object.keys(report.models ?? {}).length > 0)
}
