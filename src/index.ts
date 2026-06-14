import type { ExtensionContext, QuickPickItem } from 'vscode'
import type { ProviderModel } from './model'
import process from 'node:process'
import {
  CancellationTokenSource,
  commands,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  lm,
  window,
  workspace,
} from 'vscode'
import { configureConnection } from './credentials'
import { CLIProxyLanguageModelProvider } from './provider'

let provider: CLIProxyLanguageModelProvider | undefined

export interface ModelProviderTestApi {
  configure: (baseUrl: string, apiKey: string) => Promise<void>
  models: () => Promise<ProviderModel[]>
  request: (modelId: string, prompt: string, reasoningEffort?: string) => Promise<string>
  countTokens: (modelId: string, value: string) => Promise<number>
}

export function activate(context: ExtensionContext): ModelProviderTestApi | undefined {
  const output = window.createOutputChannel('CLIProxyAPI Model Provider', { log: true })
  provider = new CLIProxyLanguageModelProvider(context, output)

  context.subscriptions.push(
    output,
    provider,
    lm.registerLanguageModelChatProvider('cliproxyapi', provider),
    commands.registerCommand('modelProvider.manage', async () => manageProvider()),
    commands.registerCommand('modelProvider.configure', async () => {
      await configureConnection()
      await provider?.forceRefresh(false)
    }),
    commands.registerCommand('modelProvider.importConfig', async () => {
      await provider?.importConfig()
    }),
    commands.registerCommand('modelProvider.refresh', async () => {
      const models = await provider?.forceRefresh(true) ?? []
      void window.showInformationMessage(`CLIProxyAPI exposed ${models.length} chat models.`)
    }),
    commands.registerCommand('modelProvider.clearCredentials', async () => {
      const choice = await window.showWarningMessage(
        'Remove the stored CLIProxyAPI API key from VS Code SecretStorage?',
        { modal: true },
        'Remove',
      )
      if (choice === 'Remove')
        await provider?.clearCredentials()
    }),
    commands.registerCommand('modelProvider.showLogs', () => output.show(true)),
    workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('modelProvider'))
        await provider?.forceRefresh(false)
    }),
  )

  if (process.env.MODEL_PROVIDER_TEST === '1')
    return createTestApi()
}

export function deactivate(): void {
  provider = undefined
}

async function manageProvider(): Promise<void> {
  const choices: Array<QuickPickItem & { command: string }> = [
    {
      label: '$(refresh) Refresh Models',
      description: 'Re-read models and capabilities from CLIProxyAPI',
      command: 'modelProvider.refresh',
    },
    {
      label: '$(settings-gear) Configure Connection',
      description: 'Set the proxy URL and optional config path',
      command: 'modelProvider.configure',
    },
    {
      label: '$(key) Import API Key from Config',
      description: 'Confirm and store a key from CLIProxyAPI config.yaml',
      command: 'modelProvider.importConfig',
    },
    {
      label: '$(output) Show Logs',
      description: 'Open the provider output channel',
      command: 'modelProvider.showLogs',
    },
    {
      label: '$(trash) Clear Stored API Key',
      description: 'Remove the key from VS Code SecretStorage',
      command: 'modelProvider.clearCredentials',
    },
  ]
  const selected = await window.showQuickPick(choices, {
    title: 'Manage CLIProxyAPI Model Provider',
    placeHolder: 'Choose an action',
  })
  if (selected)
    await commands.executeCommand(selected.command)
}

function createTestApi(): ModelProviderTestApi {
  return {
    async configure(baseUrl, apiKey) {
      await workspace.getConfiguration('modelProvider').update('baseUrl', baseUrl, true)
      await provider?.setApiKeyForTesting(apiKey)
      await provider?.forceRefresh(false)
    },
    async models() {
      return await provider?.forceRefresh(false) ?? []
    },
    async request(modelId, prompt, reasoningEffort) {
      const model = (await provider?.forceRefresh(false))?.find(candidate => candidate.id === modelId)
      if (provider === undefined || model === undefined)
        throw new Error(`Model ${modelId} is unavailable.`)
      const parts: string[] = []
      const token = new CancellationTokenSource()
      try {
        await provider.provideLanguageModelChatResponse(
          model,
          [{
            role: LanguageModelChatMessageRole.User,
            content: [new LanguageModelTextPart(prompt)],
            name: undefined,
          }],
          {
            requestInitiator: 'maxdewald.modelprovider.integration-test',
            toolMode: LanguageModelChatToolMode.Auto,
            ...(reasoningEffort === undefined ? {} : { modelConfiguration: { reasoningEffort } }),
          },
          {
            report(value) {
              if (value instanceof LanguageModelTextPart)
                parts.push(value.value)
            },
          },
          token.token,
        )
      }
      finally {
        token.dispose()
      }
      return parts.join('')
    },
    async countTokens(modelId, value) {
      const model = (await provider?.forceRefresh(false))?.find(candidate => candidate.id === modelId)
      if (provider === undefined || model === undefined)
        throw new Error(`Model ${modelId} is unavailable.`)
      const token = new CancellationTokenSource()
      try {
        return await provider.provideTokenCount(model, value, token.token)
      }
      finally {
        token.dispose()
      }
    },
  }
}
