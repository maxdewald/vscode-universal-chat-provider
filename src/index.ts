import type { ProviderModel } from '@src/chat/models/model'
import type { ServerStatus } from '@src/cliproxy/controller'
import type { ExtensionContext } from 'vscode'
import { UniversalChatProvider } from '@src/chat/provider'
import { ServerController } from '@src/cliproxy/controller'
import { registerCommands } from '@src/extension/commands'
import { createFastModeNudge } from '@src/extension/fast-mode-nudge'
import { createStatusBar, updateStatusBar } from '@src/extension/ui/status-bar'
import { maybeSuggestUtilityModel } from '@src/extension/utility-model-nudge'
import { setJsonValidationErrorReporter } from '@src/shared/json'
import { lm, window, workspace } from 'vscode'

let provider: UniversalChatProvider | undefined
let controller: ServerController | undefined

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Universal Chat Provider', { log: true })
  const serverOutput = window.createOutputChannel('CLIProxyAPI Server')
  setJsonValidationErrorReporter(message => output.error(message))
  controller = new ServerController(context, output, serverOutput)
  provider = new UniversalChatProvider(context, output, controller, async () => controller!.login())
  const suggestFastMode = createFastModeNudge(context, controller)
  let foreground: { model: ProviderModel, at: number } | undefined

  const statusBar = createStatusBar()
  // Status and quota arrive on separate listeners; re-render the bar from both on either change.
  let lastStatus: ServerStatus = 'starting'
  const renderStatusBar = (): void => updateStatusBar(statusBar, lastStatus, provider?.quotaSections() ?? [], provider?.currentModelQuota())
  provider.onActivity = (model, isForeground) => {
    if (isForeground)
      foreground = { model, at: Date.now() }
    renderStatusBar()
    void controller!.refreshQuotas()
  }
  controller.setRefreshListener(async (expectedModelIds) => {
    await provider?.forceRefresh(false, expectedModelIds)
  })
  controller.setStatusListener((status) => {
    lastStatus = status
    renderStatusBar()
  })
  controller.setQuotaListener((reports) => {
    provider?.setQuotas(reports)
    renderStatusBar()
    if (foreground !== undefined && Date.now() - foreground.at < 15 * 60_000) {
      void suggestFastMode(foreground.model, provider?.fastModel(foreground.model), reports)
        .catch(error => output.error('Fast Mode suggestion failed', error))
    }
  })
  renderStatusBar()

  context.subscriptions.push(
    output,
    serverOutput,
    controller,
    statusBar,
    provider,
    provider.onDidChangeLanguageModelChatInformation(() => {
      void maybeSuggestUtilityModel(context, provider!)
        .catch(error => output.error('Utility model suggestion failed', error))
    }),
    // Re-render when the quota-warning settings change so the bar reflects them without a restart.
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('universalChatProvider.showQuotaWarnings') || event.affectsConfiguration('universalChatProvider.quotaWarningThreshold'))
        renderStatusBar()
    }),
    lm.registerLanguageModelChatProvider('universal-chat-provider', provider),
    ...registerCommands(provider, controller, output, serverOutput, context),
  )

  statusBar.show()
  void provider.initialize().then(async () => controller?.refreshQuotas())
}

export function deactivate(): void {
  provider = undefined
  controller = undefined
}
