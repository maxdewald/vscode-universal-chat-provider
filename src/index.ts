import type { ExtensionContext } from 'vscode'
import { lm, window } from 'vscode'
import { UniversalChatProvider } from './chat/provider'
import { ServerController } from './cliproxy/controller'
import { CommitMessageService } from './commit/service'
import { registerCommands } from './extension/commands'
import { createStatusBar, updateStatusBar } from './extension/status-bar'

let provider: UniversalChatProvider | undefined
let controller: ServerController | undefined

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Universal Chat Provider', { log: true })
  controller = new ServerController(context, output)
  provider = new UniversalChatProvider(context, output, controller)
  const commitMessages = new CommitMessageService(provider)

  const statusBar = createStatusBar()
  controller.setRefreshListener(() => void provider?.forceRefresh(false))
  controller.setStatusListener(status => updateStatusBar(statusBar, status))

  context.subscriptions.push(
    output,
    controller,
    statusBar,
    provider,
    lm.registerLanguageModelChatProvider('universal-chat-provider', provider),
    ...registerCommands({ provider, controller, commitMessages, output }),
  )

  statusBar.show()
  void provider.initialize()
}

export function deactivate(): void {
  provider = undefined
  controller = undefined
}
