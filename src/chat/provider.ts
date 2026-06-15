import type {
  CancellationToken,
  Event,
  ExtensionContext,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart2,
  OutputChannel,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode'
import type { ProxyConnection } from '../cliproxy/connection'
import type { CompletionDeps } from './completion'
import type { ProviderModel } from './model'
import {
  LanguageModelTextPart,
  LanguageModelThinkingPart,
  LanguageModelToolCallPart,
} from 'vscode'
import { SettingsConnection } from '../cliproxy/connection'
import { CredentialStore } from '../cliproxy/credentials'
import { asString } from '../shared/json'
import { streamCompletion } from './completion'
import { CredentialFlows } from './credential-flows'
import { ModelRegistry } from './model-registry'
import { buildRequest, buildTextRequest } from './request'
import { TokenCounter } from './token-counter'

/**
 * The VS Code language-model provider surface. It owns the collaborators —
 * {@link ModelRegistry} for discovery, {@link CredentialFlows} for onboarding,
 * and {@link streamCompletion} for requests — and wires them together.
 */
export class UniversalChatProvider implements LanguageModelChatProvider<ProviderModel> {
  private readonly credentials: CredentialStore
  private readonly registry: ModelRegistry
  private readonly credentialFlows: CredentialFlows
  private readonly tokenCounter: TokenCounter

  constructor(
    context: ExtensionContext,
    private readonly output: OutputChannel,
    private readonly connection: ProxyConnection = new SettingsConnection(),
  ) {
    this.credentials = new CredentialStore(context)
    this.registry = new ModelRegistry(connection, this.credentials, output, {
      acquireApiKey: async () => this.credentialFlows.acquireApiKey(),
      onCredentialsRejected: () => void this.credentialFlows.showCredentialRecovery(),
      onCredentialsAccepted: () => this.credentialFlows.markCredentialsAccepted(),
    })
    this.credentialFlows = new CredentialFlows(this.credentials, this.registry, output)
    this.tokenCounter = new TokenCounter({ connection, credentials: this.credentials, output })
  }

  get onDidChangeLanguageModelChatInformation(): Event<void> {
    return this.registry.onDidChange
  }

  dispose(): void {
    this.registry.dispose()
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
    return this.registry.refresh(!options.silent, token)
  }

  async provideLanguageModelChatResponse(
    model: ProviderModel,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart2>,
    token: CancellationToken,
  ): Promise<void> {
    const reasoningEffort = asString(options.modelConfiguration?.reasoningEffort)
    await streamCompletion(
      this.completionDeps(),
      buildRequest(model, messages, options, reasoningEffort),
      {
        onText: delta => progress.report(new LanguageModelTextPart(delta)),
        onThinking: delta => progress.report(new LanguageModelThinkingPart(delta)),
        onToolCall: (callId, name, input) =>
          progress.report(new LanguageModelToolCallPart(callId, name, input)),
        onUsage: usage => this.output.appendLine(`[usage] ${model.proxyModelId}: ${JSON.stringify(usage)}`),
      },
      token,
    )
  }

  async provideTokenCount(
    model: ProviderModel,
    value: string | LanguageModelChatRequestMessage,
    token: CancellationToken,
  ): Promise<number> {
    return this.tokenCounter.count(model, value, token)
  }

  async getModels(interactive: boolean, token?: CancellationToken): Promise<readonly ProviderModel[]> {
    return this.registry.refresh(interactive, token)
  }

  async forceRefresh(interactive = true): Promise<ProviderModel[]> {
    return this.registry.forceRefresh(interactive)
  }

  async completeText(
    model: ProviderModel,
    prompt: string,
    maxOutputTokens: number,
    token?: CancellationToken,
  ): Promise<string | undefined> {
    if (token?.isCancellationRequested)
      return undefined

    let text = ''
    await streamCompletion(
      this.completionDeps(),
      buildTextRequest(model, prompt, maxOutputTokens),
      {
        onText: (delta) => { text += delta },
        onToolCall: () => {},
        onUsage: usage =>
          this.output.appendLine(`[usage] ${model.proxyModelId} (commit message): ${JSON.stringify(usage)}`),
      },
      token,
    )
    return token?.isCancellationRequested ? undefined : text
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

  private completionDeps(): CompletionDeps {
    return {
      connection: this.connection,
      credentials: this.credentials,
      onCredentialsRejected: () => void this.credentialFlows.showCredentialRecovery(),
    }
  }
}
