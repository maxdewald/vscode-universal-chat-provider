import type { ServerStatus } from '@src/cliproxy/controller'
import type { ExtensionContext } from 'vscode'
import { UniversalChatProvider } from '@src/chat/provider'
import { ServerController } from '@src/cliproxy/controller'
import { registerCommands } from '@src/extension/commands'
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

  const statusBar = createStatusBar()
  // Status and quota arrive on separate listeners; re-render the bar from both on either change.
  let lastStatus: ServerStatus = 'starting'
  const renderStatusBar = (): void => updateStatusBar(statusBar, lastStatus, provider?.quotaSections() ?? [], provider?.currentModelQuota())
  // On each request: re-render for the now-active model and refresh quota (throttled) after the spend.
  provider.onActivity = () => {
    renderStatusBar()
    controller!.scheduleQuotaRefresh()
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
  })
  renderStatusBar()

  context.subscriptions.push(
    output,
    serverOutput,
    controller,
    statusBar,
    provider,
    // Re-render when the quota-warning settings change so the bar reflects them without a restart.
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('universalChatProvider.showQuotaWarnings') || event.affectsConfiguration('universalChatProvider.quotaWarningThreshold'))
        renderStatusBar()
    }),
    lm.registerLanguageModelChatProvider('universal-chat-provider', provider),
    ...registerCommands(provider, controller, output, serverOutput),
  )

  statusBar.show()
  void provider.initialize()
  void maybeSuggestUtilityModel(context)
}

export function deactivate(): void {
  provider = undefined
  controller = undefined
}
