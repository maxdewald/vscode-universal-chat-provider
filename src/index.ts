import type { ExtensionContext } from 'vscode'
import { lm, window } from 'vscode'
import { UniversalChatProvider } from './chat/provider'
import { maybeSuggestUtilityModel } from './chat/utility-model-nudge'
import { ServerController } from './cliproxy/controller'
import { registerCommands } from './extension/commands'
import { createStatusBar, updateStatusBar } from './extension/status-bar'

let provider: UniversalChatProvider | undefined
let controller: ServerController | undefined

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Universal Chat Provider', { log: true })
  const serverOutput = window.createOutputChannel('CLIProxyAPI Server')
  controller = new ServerController(context, output, serverOutput)
  provider = new UniversalChatProvider(context, output, controller, async () => controller!.login())

  const statusBar = createStatusBar()
  controller.setRefreshListener(() => void provider?.forceRefresh(false))
  controller.setStatusListener(status => updateStatusBar(statusBar, status))
  controller.setQuotaListener(reports => provider?.setQuotas(reports))

  context.subscriptions.push(
    output,
    serverOutput,
    controller,
    statusBar,
    provider,
    lm.registerLanguageModelChatProvider('universal-chat-provider', provider),
    ...registerCommands({ provider, controller, output, serverOutput }),
  )

  statusBar.show()
  void provider.initialize()
  void maybeSuggestUtilityModel(context)
}

export function deactivate(): void {
  provider = undefined
  controller = undefined
}
