import type { ExtensionContext, QuickPickItem, StatusBarItem } from 'vscode'
import type { ServerStatus, ServerStatusSnapshot } from './managed/controller'
import {
  commands,
  lm,
  QuickPickItemKind,
  StatusBarAlignment,
  window,
} from 'vscode'
import { CommitMessageService } from './commit-message'
import { ServerController } from './managed/controller'
import { UniversalChatProvider } from './provider'

let provider: UniversalChatProvider | undefined
let controller: ServerController | undefined

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Universal Chat Provider', { log: true })
  controller = new ServerController(context, output)
  provider = new UniversalChatProvider(context, output, controller)
  const commitMessages = new CommitMessageService(provider)

  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.command = 'universalChatProvider.manage'
  controller.setRefreshListener(() => void provider?.forceRefresh(false))
  controller.setStatusListener(status => updateStatusBar(statusBar, status))

  context.subscriptions.push(
    output,
    controller,
    statusBar,
    provider,
    lm.registerLanguageModelChatProvider('universal-chat-provider', provider),
    commands.registerCommand('universalChatProvider.manage', async () => manageProvider()),
    commands.registerCommand('universalChatProvider.login', async () => {
      await controller?.login()
    }),
    commands.registerCommand('universalChatProvider.manageAccounts', async () => {
      await controller?.manageAccounts()
    }),
    commands.registerCommand('universalChatProvider.configure', async () => {
      await provider?.configure()
    }),
    commands.registerCommand('universalChatProvider.importConfig', async () => {
      await provider?.importConfig()
    }),
    commands.registerCommand('universalChatProvider.refresh', async () => {
      const models = await provider?.forceRefresh(true) ?? []
      void window.showInformationMessage(`CLIProxyAPI exposed ${models.length} chat models.`)
    }),
    commands.registerCommand('universalChatProvider.restartServer', async () => {
      await controller?.restartServer()
    }),
    commands.registerCommand('universalChatProvider.updateBinary', async () => {
      await controller?.updateBinary()
    }),
    commands.registerCommand('universalChatProvider.resetServer', async () => {
      await controller?.resetServer()
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
        await provider?.clearCredentials()
    }),
    commands.registerCommand('universalChatProvider.showLogs', () => output.show(true)),
  )

  statusBar.show()
  void provider.initialize()
}

export function deactivate(): void {
  provider = undefined
  controller = undefined
}

function updateStatusBar(statusBar: StatusBarItem, status: ServerStatus): void {
  const presentation: Record<ServerStatus, { text: string, tooltip: string }> = {
    external: { text: '$(server) Universal Chat Provider', tooltip: 'Universal Chat Provider: using an external server' },
    starting: { text: '$(loading~spin) Universal Chat Provider', tooltip: 'Universal Chat Provider: starting the managed server…' },
    running: { text: '$(server-process) Universal Chat Provider', tooltip: 'Universal Chat Provider: managed server running' },
    error: { text: '$(error) Universal Chat Provider', tooltip: 'Universal Chat Provider: managed server failed to start' },
  }
  const { text, tooltip } = presentation[status]
  statusBar.text = text
  statusBar.tooltip = tooltip
}

interface ActionItem extends QuickPickItem { command: string }
type Choice = QuickPickItem & { command?: string }

function divider(): Choice {
  return { label: '', kind: QuickPickItemKind.Separator }
}

async function manageProvider(): Promise<void> {
  const managed = controller?.mode() !== 'external'
  const snapshot = await controller?.statusSnapshot()

  // Logical groups, separated only by plain dividers — the descriptions carry
  // the meaning, so no floating section labels are needed.
  const groups: ActionItem[][] = [
    [
      {
        label: '$(account) Add Account (Login)',
        description: 'Gemini, Codex, Claude, and more',
        command: 'universalChatProvider.login',
      },
      {
        label: '$(organization) Manage Accounts',
        description: 'List or remove connected accounts',
        command: 'universalChatProvider.manageAccounts',
      },
    ],
    [
      {
        label: '$(refresh) Refresh Models',
        description: 'Reload models and capabilities',
        command: 'universalChatProvider.refresh',
      },
      {
        label: '$(sparkle) Select Commit Message Model',
        description: 'Model used for commit messages',
        command: 'universalChatProvider.selectCommitMessageModel',
      },
    ],
    managed
      ? [
          {
            label: '$(debug-restart) Restart Server',
            description: 'Restart the managed server',
            command: 'universalChatProvider.restartServer',
          },
          {
            label: '$(cloud-download) Update Proxy Binary',
            description: 'Install the configured version',
            command: 'universalChatProvider.updateBinary',
          },
          {
            label: '$(discard) Reset Managed Server',
            description: 'Recreate the config and keys',
            command: 'universalChatProvider.resetServer',
          },
        ]
      : [
          {
            label: '$(settings-gear) Configure Connection',
            description: 'Set the proxy URL and config path',
            command: 'universalChatProvider.configure',
          },
          {
            label: '$(key) Import API Key from Config',
            description: 'Load an API key from config.yaml',
            command: 'universalChatProvider.importConfig',
          },
        ],
    [
      {
        label: '$(trash) Clear Stored API Key',
        description: 'Remove the key from SecretStorage',
        command: 'universalChatProvider.clearCredentials',
      },
    ],
  ]

  const body = groups.flatMap((group, index) => (index === 0 ? group : [divider(), ...group]))
  const choices: Choice[] = snapshot !== undefined
    ? [statusEntry(snapshot), divider(), ...body]
    : body
  const selected = await window.showQuickPick(choices, {
    title: 'Manage Universal Chat Provider',
    placeHolder: 'Choose an action',
  })
  if (selected?.command !== undefined)
    await commands.executeCommand(selected.command)
}

/**
 * The rich status row shown at the top of the manage picker. Selecting it opens
 * the logs — the natural drill-in when the server is starting or unhealthy.
 */
function statusEntry(snapshot: ServerStatusSnapshot): QuickPickItem & { command: string } {
  const presentation: Record<ServerStatus, { icon: string, label: string }> = {
    external: { icon: '$(server)', label: 'External CLI Proxy API server' },
    starting: { icon: '$(loading~spin)', label: 'Managed CLI Proxy API server starting…' },
    running: { icon: '$(server-process)', label: 'Managed CLI Proxy API server running' },
    error: { icon: '$(error)', label: 'Managed CLI Proxy API server failed to start' },
  }
  const { icon, label } = presentation[snapshot.status]
  const accounts = snapshot.accounts === undefined
    ? undefined
    : `${snapshot.accounts} ${snapshot.accounts === 1 ? 'account' : 'accounts'} connected`
  const detail = [
    snapshot.version !== undefined ? `Version ${snapshot.version}` : undefined,
    accounts,
    'Select to view logs',
  ].filter((part): part is string => part !== undefined).join('  ·  ')
  return {
    // Codicons render in the label and description, but not the detail — keep
    // the detail plain so it never shows a literal `$(…)`.
    label: `${icon} ${label}`,
    description: snapshot.baseUrl.replace(/^https?:\/\//, ''),
    detail,
    command: 'universalChatProvider.showLogs',
  }
}
