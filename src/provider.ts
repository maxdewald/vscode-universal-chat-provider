import type {
  CancellationToken,
  ExtensionContext,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart2,
  OutputChannel,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode'
import type { ProviderModel } from './model'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import {
  EventEmitter,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelError,
  LanguageModelTextPart,
  LanguageModelThinkingPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  window,
  workspace,
} from 'vscode'
import { CredentialStore, normalizeBaseUrl } from './credentials'
import { mapProxyModels } from './model'
import { CLIProxyClient, ProxyHttpError } from './proxy-client'
import { countTokens } from './tokenizer'

export class CLIProxyLanguageModelProvider implements LanguageModelChatProvider<ProviderModel> {
  private readonly changeEmitter = new EventEmitter<void>()
  private readonly credentials: CredentialStore
  private cachedModels: ProviderModel[] = []
  private cachedFingerprint = ''
  private refreshTimer?: NodeJS.Timeout
  private refreshPromise: Promise<ProviderModel[]> | undefined

  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event

  constructor(
    context: ExtensionContext,
    private readonly output: OutputChannel,
  ) {
    this.credentials = new CredentialStore(context)
    context.subscriptions.push(this.changeEmitter)
    this.scheduleRefresh()
  }

  dispose(): void {
    if (this.refreshTimer)
      clearTimeout(this.refreshTimer)
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<ProviderModel[]> {
    if (token.isCancellationRequested)
      return []
    return this.refresh(!options.silent, token)
  }

  async provideLanguageModelChatResponse(
    model: ProviderModel,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart2>,
    token: CancellationToken,
  ): Promise<void> {
    const apiKey = await this.credentials.get()
    if (apiKey === undefined)
      throw LanguageModelError.NoPermissions('Configure a CLIProxyAPI API key first.')

    const controller = new AbortController()
    const cancellation = token.onCancellationRequested(() => controller.abort())
    const client = new CLIProxyClient(this.baseUrl(), apiKey)
    const reasoningEffort = stringValue(options.modelConfiguration?.reasoningEffort)

    try {
      await client.streamResponse(
        buildRequest(model, messages, options, reasoningEffort),
        {
          onText: delta => progress.report(new LanguageModelTextPart(delta)),
          onThinking: delta => progress.report(new LanguageModelThinkingPart(delta)),
          onToolCall: (callId, name, input) =>
            progress.report(new LanguageModelToolCallPart(callId, name, input)),
          onUsage: usage => this.output.appendLine(`[usage] ${model.proxyModelId}: ${JSON.stringify(usage)}`),
        },
        controller.signal,
      )
    }
    catch (error) {
      if (token.isCancellationRequested)
        return
      throw mapProviderError(error)
    }
    finally {
      cancellation.dispose()
    }
  }

  async provideTokenCount(
    _model: ProviderModel,
    value: string | LanguageModelChatRequestMessage,
    token: CancellationToken,
  ): Promise<number> {
    if (token.isCancellationRequested)
      return 0
    return countTokens(value)
  }

  async forceRefresh(interactive = true): Promise<ProviderModel[]> {
    this.refreshPromise = undefined
    return this.refresh(interactive)
  }

  async importConfig(): Promise<void> {
    const key = await this.credentials.importFromConfig(true)
    if (key !== undefined)
      await this.forceRefresh(false)
  }

  async clearCredentials(): Promise<void> {
    await this.credentials.clear()
    this.cachedModels = []
    this.cachedFingerprint = ''
    this.changeEmitter.fire()
  }

  async setApiKeyForTesting(apiKey: string): Promise<void> {
    if (process.env.MODEL_PROVIDER_TEST !== '1')
      throw new Error('The test API is disabled.')
    await this.credentials.set(apiKey)
  }

  private async refresh(interactive: boolean, token?: CancellationToken): Promise<ProviderModel[]> {
    if (this.refreshPromise !== undefined)
      return this.refreshPromise
    this.refreshPromise = this.doRefresh(interactive, token).finally(() => {
      this.refreshPromise = undefined
      this.scheduleRefresh()
    })
    return this.refreshPromise
  }

  private async doRefresh(interactive: boolean, token?: CancellationToken): Promise<ProviderModel[]> {
    let apiKey = await this.credentials.get()
    if (apiKey === undefined && interactive)
      apiKey = await this.acquireApiKey()
    if (apiKey === undefined)
      return []

    const controller = new AbortController()
    const cancellation = token?.onCancellationRequested(() => controller.abort())
    try {
      const client = new CLIProxyClient(this.baseUrl(), apiKey)
      const discovery = await client.discover(controller.signal)
      const settings = workspace.getConfiguration('modelProvider')
      const models = mapProxyModels(discovery.available, discovery.metadata, discovery.catalog, {
        defaultMaxOutputTokens: settings.get<number>('defaultMaxOutputTokens', 16_384),
      })
      const fingerprint = JSON.stringify(models)
      if (fingerprint !== this.cachedFingerprint) {
        this.cachedFingerprint = fingerprint
        this.cachedModels = models
        this.changeEmitter.fire()
      }
      this.output.appendLine(`Discovered ${models.length} CLIProxyAPI chat models at ${this.baseUrl()}.`)
      return this.cachedModels
    }
    catch (error) {
      this.output.appendLine(`Model discovery failed: ${errorMessage(error)}`)
      if (interactive)
        void window.showErrorMessage(`CLIProxyAPI model discovery failed: ${errorMessage(error)}`)
      return this.cachedModels
    }
    finally {
      cancellation?.dispose()
    }
  }

  private async acquireApiKey(): Promise<string | undefined> {
    const imported = await this.credentials.importFromConfig(true)
    if (imported !== undefined)
      return imported
    return this.credentials.prompt()
  }

  private baseUrl(): string {
    return normalizeBaseUrl(
      workspace.getConfiguration('modelProvider').get<string>('baseUrl', 'http://127.0.0.1:8317'),
    )
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined)
      clearTimeout(this.refreshTimer)
    const seconds = workspace.getConfiguration('modelProvider').get<number>('refreshIntervalSeconds', 60)
    this.refreshTimer = setTimeout(() => void this.refresh(false), Math.max(15, seconds) * 1000)
  }
}

function buildRequest(
  model: ProviderModel,
  messages: readonly LanguageModelChatRequestMessage[],
  options: ProvideLanguageModelChatResponseOptions,
  reasoningEffort?: string,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: model.proxyModelId,
    input: messages.flatMap(convertMessage),
    stream: true,
    max_output_tokens: model.maxOutputTokens,
  }

  if (reasoningEffort !== undefined && model.reasoningLevels.includes(reasoningEffort))
    request.reasoning = { effort: reasoningEffort, summary: 'auto' }

  if (options.tools !== undefined && options.tools.length > 0) {
    request.tools = options.tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      strict: false,
    }))
    request.tool_choice = options.toolMode === LanguageModelChatToolMode.Required ? 'required' : 'auto'
    request.parallel_tool_calls = true
  }

  return request
}

function convertMessage(message: LanguageModelChatRequestMessage): Record<string, unknown>[] {
  const role = message.role === LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user'
  const content: Record<string, unknown>[] = []
  const items: Record<string, unknown>[] = []

  for (const part of message.content) {
    if (part instanceof LanguageModelTextPart) {
      content.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: part.value,
      })
    }
    else if (part instanceof LanguageModelDataPart) {
      if (part.mimeType.startsWith('image/')) {
        content.push({
          type: 'input_image',
          image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
        })
      }
      else {
        content.push({
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text: new TextDecoder().decode(part.data),
        })
      }
    }
    else if (part instanceof LanguageModelToolCallPart) {
      items.push({
        type: 'function_call',
        call_id: part.callId,
        name: part.name,
        arguments: JSON.stringify(part.input),
      })
    }
    else if (part instanceof LanguageModelToolResultPart) {
      items.push({
        type: 'function_call_output',
        call_id: part.callId,
        output: serializeToolResult(part),
      })
    }
  }

  if (content.length)
    items.unshift({ role, content })
  return items
}

function serializeToolResult(part: LanguageModelToolResultPart): string {
  return part.content.map((value) => {
    if (value instanceof LanguageModelTextPart)
      return value.value
    if (value instanceof LanguageModelDataPart) {
      return value.mimeType.startsWith('text/')
        ? new TextDecoder().decode(value.data)
        : `[${value.mimeType} data]`
    }
    return JSON.stringify(value)
  }).join('\n')
}

function mapProviderError(error: unknown): Error {
  if (error instanceof ProxyHttpError) {
    if (error.status === 401 || error.status === 403)
      return LanguageModelError.NoPermissions(error.message)
    if (error.status === 404)
      return LanguageModelError.NotFound(error.message)
    if (error.status === 429)
      return LanguageModelError.Blocked(error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
