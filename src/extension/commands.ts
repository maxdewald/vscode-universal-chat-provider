import type { UniversalChatProvider } from '@src/chat/provider'
import type { ServerController } from '@src/cliproxy/controller'
import type { ManageAction } from '@src/extension/ui/manage-menu'
import type { Disposable, OutputChannel } from 'vscode'
import { manageProvider } from '@src/extension/ui/manage-menu'
import { showQuotaMenu } from '@src/extension/ui/quota-menu'
import { setUtilityModel } from '@src/extension/utility-model-nudge'
import { extensionId } from '@src/generated/meta'
import { commands, window } from 'vscode'

interface CommandDescriptor extends ManageAction {
  run: () => unknown
}

export function registerCommands(
  provider: UniversalChatProvider,
  controller: ServerController,
  output: OutputChannel,
  serverOutput: OutputChannel,
): Disposable[] {
  const actions: CommandDescriptor[] = [
    { command: 'universalChatProvider.login', run: async () => controller.login(), group: 0, label: '$(account) Add Account (Login)', description: 'Codex, Claude, Antigravity, and more' },
    { command: 'universalChatProvider.manageAccounts', run: async () => controller.manageAccounts(), group: 0, label: '$(organization) Manage Accounts', description: 'List or remove connected accounts' },
    {
      command: 'universalChatProvider.showQuota',
      run: async () => showQuotaMenu(
        () => provider.quotaSections(),
        async () => controller.refreshQuotas(),
        controller,
      ),
      group: 0,
      label: '$(pulse) Show Quota Usage',
      description: 'Remaining quota for Codex and Antigravity accounts',
    },
    { command: 'universalChatProvider.refresh', run: async () => {
      const models = await provider.forceRefresh(true)
      void window.showInformationMessage(`CLIProxyAPI exposed ${models.length} chat models.`)
    }, group: 1, label: '$(refresh) Refresh Models', description: 'Reload models and capabilities' },
    { command: 'universalChatProvider.setUtilityModel', run: async () => setUtilityModel(provider), group: 1, label: '$(sparkle) Set Utility Model', description: 'Run Copilot\'s commit messages, titles & summaries on your models' },
    { command: 'universalChatProvider.restartServer', run: async () => controller.restartServer(), group: 2, modes: ['managed'], label: '$(debug-restart) Restart Server', description: 'Restart the managed server' },
    { command: 'universalChatProvider.updateBinary', run: async () => controller.updateBinary(), group: 2, modes: ['managed'], label: '$(cloud-download) Update Proxy Binary', description: 'Check and apply the selected update policy' },
    { command: 'universalChatProvider.resetServer', run: async () => controller.resetServer(), group: 2, modes: ['managed'], label: '$(discard) Reset Managed Server', description: 'Recreate the config and keys' },
    { command: 'universalChatProvider.configure', run: async () => provider.configure(), group: 2, modes: ['external'], label: '$(settings-gear) Configure Connection', description: 'Set the proxy URL and config path' },
    { command: 'universalChatProvider.importConfig', run: async () => provider.importConfig(), group: 2, modes: ['external'], label: '$(key) Import API Key from Config', description: 'Load an API key from config.yaml' },
    { command: 'universalChatProvider.openSettings', run: async () => commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`), group: 3, label: '$(gear) Open Settings', description: 'Edit this extension\'s settings' },
    { command: 'universalChatProvider.showLogs', run: () => output.show(true), group: 3, label: '$(output) Show Extension Logs', description: 'Diagnostics from the extension itself' },
    { command: 'universalChatProvider.clearCredentials', run: async () => {
      const choice = await window.showWarningMessage(
        'Remove the stored CLIProxyAPI API key from VS Code SecretStorage?',
        { modal: true },
        'Remove',
      )
      if (choice === 'Remove')
        await provider.clearCredentials()
    }, group: 3, label: '$(trash) Clear Stored API Key', description: 'Remove the key from SecretStorage' },
  ]
  return [
    commands.registerCommand('universalChatProvider.manage', async () => manageProvider(controller, actions)),
    commands.registerCommand('universalChatProvider.showServerLogs', () => serverOutput.show(true)),
    ...actions.map(action => commands.registerCommand(action.command, action.run)),
  ]
}
