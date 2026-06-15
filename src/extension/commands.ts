import type { Disposable, OutputChannel } from 'vscode'
import type { UniversalChatProvider } from '../chat/provider'
import type { ServerController } from '../cliproxy/controller'
import type { CommitMessageService } from '../commit/service'
import { commands, window } from 'vscode'
import { manageProvider } from './manage-menu'

export interface CommandDeps {
  provider: UniversalChatProvider
  controller: ServerController
  commitMessages: CommitMessageService
  output: OutputChannel
}

/** Register every `universalChatProvider.*` command and return its disposables. */
export function registerCommands(deps: CommandDeps): Disposable[] {
  const { provider, controller, commitMessages, output } = deps
  return [
    commands.registerCommand('universalChatProvider.manage', async () => manageProvider(controller)),
    commands.registerCommand('universalChatProvider.login', async () => {
      await controller.login()
    }),
    commands.registerCommand('universalChatProvider.manageAccounts', async () => {
      await controller.manageAccounts()
    }),
    commands.registerCommand('universalChatProvider.configure', async () => {
      await provider.configure()
    }),
    commands.registerCommand('universalChatProvider.importConfig', async () => {
      await provider.importConfig()
    }),
    commands.registerCommand('universalChatProvider.refresh', async () => {
      const models = await provider.forceRefresh(true)
      void window.showInformationMessage(`CLIProxyAPI exposed ${models.length} chat models.`)
    }),
    commands.registerCommand('universalChatProvider.restartServer', async () => {
      await controller.restartServer()
    }),
    commands.registerCommand('universalChatProvider.updateBinary', async () => {
      await controller.updateBinary()
    }),
    commands.registerCommand('universalChatProvider.resetServer', async () => {
      await controller.resetServer()
    }),
    commands.registerCommand('universalChatProvider.generateCommitMessage', async (...args: Parameters<CommitMessageService['generate']>) => {
      await commitMessages.generate(...args)
    }),
    commands.registerCommand('universalChatProvider.selectCommitMessageModel', async () => {
      await commitMessages.selectModel()
    }),
    commands.registerCommand('universalChatProvider.clearCredentials', async () => {
      const choice = await window.showWarningMessage(
        'Remove the stored CLIProxyAPI API key from VS Code SecretStorage?',
        { modal: true },
        'Remove',
      )
      if (choice === 'Remove')
        await provider.clearCredentials()
    }),
    commands.registerCommand('universalChatProvider.showLogs', () => output.show(true)),
  ]
}
