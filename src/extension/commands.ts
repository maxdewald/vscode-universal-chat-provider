import type { UniversalChatProvider } from '@src/chat/provider'
import type { ServerController } from '@src/cliproxy/controller'
import type { Disposable, OutputChannel } from 'vscode'
import { manageProvider } from '@src/extension/ui/manage-menu'
import { showQuotaMenu } from '@src/extension/ui/quota-menu'
import { setUtilityModel } from '@src/extension/utility-model-nudge'
import { extensionId } from '@src/generated/meta'
import { commands, window } from 'vscode'

export function registerCommands(
  provider: UniversalChatProvider,
  controller: ServerController,
  output: OutputChannel,
  serverOutput: OutputChannel,
): Disposable[] {
  return [
    commands.registerCommand('universalChatProvider.manage', async () => manageProvider(controller)),
    commands.registerCommand('universalChatProvider.login', async () => {
      await controller.login()
    }),
    commands.registerCommand('universalChatProvider.manageAccounts', async () => {
      await controller.manageAccounts()
    }),
    commands.registerCommand('universalChatProvider.showQuota', async () => {
      await showQuotaMenu(
        () => provider.quotaSections(),
        async () => controller.refreshQuotas(),
        controller,
      )
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
    commands.registerCommand('universalChatProvider.setUtilityModel', async () => {
      await setUtilityModel(provider)
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
    commands.registerCommand('universalChatProvider.showServerLogs', () => serverOutput.show(true)),
    commands.registerCommand('universalChatProvider.openSettings', async () => {
      await commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`)
    }),
  ]
}
