import type { StatusBarItem } from 'vscode'
import type { ServerStatus } from '../cliproxy/controller'
import { StatusBarAlignment, window } from 'vscode'

/** Create the manage-provider status bar item (opens the manage menu on click). */
export function createStatusBar(): StatusBarItem {
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.command = 'universalChatProvider.manage'
  return statusBar
}

export function updateStatusBar(statusBar: StatusBarItem, status: ServerStatus): void {
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
