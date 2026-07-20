import type { Disposable, OutputChannel } from 'vscode'
import type { UniversalChatProvider } from '../chat/provider'
import type { ServerController } from '../cliproxy/controller'
import { commands, window, workspace } from 'vscode'
import { normalizeBaseUrl } from '../cliproxy/credentials'
import { setUtilityModel } from '../chat/utility-model-nudge'
import { extensionId } from '../generated/meta'
import { manageProvider } from './manage-menu'
import { showQuotaMenu } from './quota-menu'

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
    commands.registerCommand('universalChatProvider.setProxyConfig', async () => {
      const current = await controller.getProxyUrl()
      const baseUrl = await window.showInputBox({
        title: 'CLIProxyAPI Base URL',
        value: current ?? '',
        prompt: 'Base URL of the CLIProxyAPI server.',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value.trim().length === 0)
            return undefined
          try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:' ? undefined : 'Use an http:// or https:// URL.' }
          catch { return 'Enter a valid URL.' }
        },
      })
      if (baseUrl === undefined)
        return
      if (controller.mode() !== 'managed') {
        void window.showInformationMessage('Set Proxy in config applies only to the managed server.')
        return
      }
      await controller.setProxyUrl(normalizeBaseUrl(baseUrl))
    }),
    commands.registerCommand('universalChatProvider.openSettings', async () => {
      await commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`)
    }),
  ]
}
