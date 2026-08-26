import type { ProviderModel } from '@src/chat/models/model'
import type { CompletionDeps } from '@src/chat/requests/completion'
import type { WebCitation } from '@src/cliproxy/api/proxy-client'
import type { ProxyConnection } from '@src/cliproxy/connection'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import type {
  CancellationToken,
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
import { urlHostname } from '@src/shared/url'
import * as vscode from 'vscode'
import {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from 'vscode'

const UCP_PREFIX = 'universal-chat-provider/'
const UTILITY_SUFFIX = ':utility-'
const UTILITY_SETTINGS = ['utilityModel', 'utilitySmallModel'] as const

interface HostChatResponseOptions {
  modelConfiguration?: { contextSize?: number, reasoningEffort?: string }
}

export function utilityModelId(modelId: string, effort: string): string {
  return `${modelId}${UTILITY_SUFFIX}${effort}`
}

// Not yet in the published @types/vscode this project pins; present at runtime in Copilot Chat.
const LanguageModelThinkingPart = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as new (value: string) => LanguageModelResponsePart

export class UniversalChatProvider implements LanguageModelChatProvider<ProviderModel> {
  private readonly credentials: CredentialStore
  private readonly registry: ModelRegistry
  private readonly credentialFlows: CredentialFlows
  private readonly cacheMetrics: CacheMetricsTracker
  private readonly modelsChanged = new vscode.EventEmitter<void>()
  private readonly disposables: vscode.Disposable[] = []
  private quotaReports: QuotaReport[] = []
  private lastUsedModel: { proxyModelId: string, proxyOwner: string, name: string } | undefined
  onActivity: ((model: { proxyOwner: string }) => void) | undefined

  constructor(
    context: ExtensionContext,
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
    this.disposables.push(
      this.registry.onDidChange(() => this.modelsChanged.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (UTILITY_SETTINGS.some(setting => event.affectsConfiguration(`chat.${setting}`)))
          this.modelsChanged.fire()
      }),
    )
  }

  readonly onDidChangeLanguageModelChatInformation = this.modelsChanged.event

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

  currentModelQuota(): { name: string, remainingPercent: number } | undefined {
    if (this.lastUsedModel === undefined)
      return undefined
    const remaining = remainingForModel(this.quotaReports, this.lastUsedModel)
    return remaining === undefined ? undefined : { name: this.lastUsedModel.name, remainingPercent: remaining }
  }

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
    for (const disposable of this.disposables)
      disposable.dispose()
    this.modelsChanged.dispose()
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
      return withUtilityAliases(await this.registry.forceRefresh(false))
    }
    return withUtilityAliases(await this.registry.refresh(!options.silent, token))
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
    const targetModel = compaction === 'separate'
      ? this.compactionModel(model, requestOptions.modelConfiguration?.contextSize)
      : model
    this.lastUsedModel = { proxyModelId: targetModel.proxyModelId, proxyOwner: targetModel.proxyOwner, name: targetModel.name }
    const utilityRequest = model.id.includes(UTILITY_SUFFIX)
    const chosenEffort = compaction !== undefined
      // Compaction is prose over a transcript-sized prompt, so the lowest level is what makes it fast.
      ? targetModel.reasoningLevels[0]
      : utilityRequest
        ? model.reasoningEffort
        : requestOptions.modelConfiguration?.reasoningEffort ?? targetModel.reasoningEffort
    const webSearch = !utilityRequest
      && compaction === undefined
      && targetModel.supportsWebSearch
    const request = await buildRequest(targetModel, messages, options, {
      reasoningEffort: chosenEffort,
      omitTools: compaction !== undefined,
      webSearch,
    })
    const citations: WebCitation[] = []
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
          onCitation: citation => citations.push(citation),
          onUsage: (usage) => {
            recordUsage(usage)
            const part = createContextUsagePart(usage)
            if (part !== undefined)
              progress.report(part)
          },
        },
        token,
      )
      if (citations.length > 0)
        progress.report(new LanguageModelTextPart(formatCitations(citations)))
    }
    catch (error) {
      const effort = request.reasoning?.effort
      this.output.appendLine(
        `[request] failed model=${targetModel.proxyModelId}`
        + `${effort === undefined ? '' : ` effort=${effort}`}`
        + ` error=${errorMessage(error)}`,
      )
      if (utilityRequest || compaction !== undefined)
        void vscode.window.showErrorMessage(`Utility model request failed: ${errorMessage(error)}`)
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
  private compactionModel(current: ProviderModel, selectedContextSize: number | undefined): ProviderModel {
    const configured = vscode.workspace.getConfiguration('chat').get<string>('utilityModel', '').trim()
    if (!configured.startsWith(UCP_PREFIX))
      return current
    const configuredId = configured.slice(UCP_PREFIX.length).split(UTILITY_SUFFIX)[0]!
    const utility = this.registry.snapshot().find(candidate => candidate.id === configuredId)
    const requiredContext = selectedContextSize
      ?? current.configurationSchema?.properties.contextSize.default
      ?? current.maxInputTokens
    return utility !== undefined && utility.maxInputTokens >= requiredContext ? utility : current
  }

  private completionDeps(): CompletionDeps {
    return {
      connection: this.connection,
      credentials: this.credentials,
      onCredentialsRejected: () => void this.credentialFlows.showCredentialRecovery(),
    }
  }
}

function formatCitations(citations: readonly WebCitation[]): string {
  return `\n\n**Sources**\n${citations.map((citation, index) =>
    `${index + 1}. [${escapeMarkdownLinkText(citation.title ?? urlHostname(citation.url) ?? citation.url)}](${citation.url})`,
  ).join('\n')}`
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/[\\[\]]/g, '\\$&')
}

function withUtilityAliases(models: readonly ProviderModel[]): ProviderModel[] {
  const wanted = configuredUtilityAliases()
  return models.flatMap((model) => {
    const efforts = model.reasoningLevels.filter(effort => wanted.has(utilityModelId(model.id, effort)))
    return [model, ...efforts.map(effort => toUtilityAlias(model, effort))]
  })
}

function toUtilityAlias(model: ProviderModel, effort: string): ProviderModel {
  const { reasoningEffort: _, ...properties } = model.configurationSchema?.properties ?? {}
  return {
    ...model,
    id: utilityModelId(model.id, effort),
    name: `${model.name} (Selected Utility Model)`,
    reasoningEffort: effort,
    reasoningLevels: [effort],
    isUserSelectable: false,
    ...(model.configurationSchema === undefined ? {} : { configurationSchema: { properties } as typeof model.configurationSchema }),
  }
}

function configuredUtilityAliases(): Set<string> {
  const chat = vscode.workspace.getConfiguration('chat')
  return new Set(UTILITY_SETTINGS
    .map(setting => chat.get<string>(setting, '').trim())
    .filter(value => value.startsWith(UCP_PREFIX) && value.includes(UTILITY_SUFFIX))
    .map(value => value.slice(UCP_PREFIX.length)))
}

function hasQuota(report: QuotaReport): boolean {
  return report.error === undefined && (report.windows.length > 0 || Object.keys(report.models ?? {}).length > 0)
}
