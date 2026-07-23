import type { ServerController, ServerStatus, ServerStatusSnapshot } from '@src/cliproxy/controller'
import type { QuickPickItem } from 'vscode'
import { commands, QuickPickItemKind, window } from 'vscode'

export interface ManageAction extends QuickPickItem {
  command: string
  group?: number
  modes?: Array<'managed' | 'external'>
}

type Choice = QuickPickItem & { command?: string }

function divider(): Choice {
  return { label: '', kind: QuickPickItemKind.Separator }
}

export async function manageProvider(controller: ServerController | undefined, actions: ManageAction[]): Promise<void> {
  const mode = controller?.mode() ?? 'managed'
  const snapshot = await controller?.statusSnapshot()
  let previousGroup: number | undefined
  const body = actions
    .filter(action => action.modes === undefined || action.modes.includes(mode))
    .flatMap((action) => {
      const separated = previousGroup !== undefined && action.group !== previousGroup
      previousGroup = action.group
      return separated ? [divider(), action] : [action]
    })
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

function statusEntry(snapshot: ServerStatusSnapshot): QuickPickItem & { command: string } {
  const presentation = {
    external: { icon: '$(server)', label: 'External CLI Proxy API server' },
    starting: { icon: '$(loading~spin)', label: 'Managed CLI Proxy API server starting…' },
    running: { icon: '$(server-process)', label: 'Managed CLI Proxy API server running' },
    error: { icon: '$(error)', label: 'Managed CLI Proxy API server failed to start' },
  } satisfies Record<ServerStatus, { icon: string, label: string }>
  const { icon, label } = presentation[snapshot.status]
  const accounts = snapshot.accounts === undefined
    ? undefined
    : `${snapshot.accounts} ${snapshot.accounts === 1 ? 'account' : 'accounts'} connected`
  const external = snapshot.status === 'external'
  const detail = [
    snapshot.version !== undefined ? `Version ${snapshot.version}` : undefined,
    accounts,
    external ? 'Select to view logs' : 'Select to view server output',
  ].filter((part): part is string => part !== undefined).join('  ·  ')
  return {
    label: `${icon} ${label}`,
    description: snapshot.baseUrl.replace(/^https?:\/\//, ''),
    detail,
    command: external ? 'universalChatProvider.showLogs' : 'universalChatProvider.showServerLogs',
  }
}
