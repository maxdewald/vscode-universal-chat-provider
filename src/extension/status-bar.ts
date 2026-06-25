import type { StatusBarItem } from 'vscode'
import type { ServerStatus } from '../cliproxy/controller'
import type { QuotaSection } from './quota-menu'
import { MarkdownString, StatusBarAlignment, window } from 'vscode'
import { formatPercent } from '../cliproxy/quota'

const PRESENTATION: Record<ServerStatus, { icon: string, tooltip: string }> = {
  external: { icon: '$(server)', tooltip: 'Universal Chat Provider: using an external server' },
  starting: { icon: '$(loading~spin)', tooltip: 'Universal Chat Provider: starting the managed server…' },
  running: { icon: '$(server-process)', tooltip: 'Universal Chat Provider: managed server running' },
  error: { icon: '$(error)', tooltip: 'Universal Chat Provider: managed server failed to start' },
}

export function createStatusBar(): StatusBarItem {
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.command = 'universalChatProvider.manage'
  return statusBar
}

export function updateStatusBar(statusBar: StatusBarItem, status: ServerStatus, sections: QuotaSection[] = []): void {
  const { icon, tooltip } = PRESENTATION[status]
  statusBar.text = `${icon} Universal Chat Provider`
  statusBar.tooltip = buildTooltip(icon, tooltip, sections)
}

function buildTooltip(icon: string, header: string, sections: QuotaSection[]): MarkdownString {
  const md = new MarkdownString()
  md.supportThemeIcons = true
  md.appendMarkdown(`${icon} **${header}**\n\n`)
  for (const section of sections) {
    md.appendMarkdown(`| **${section.title}** | | |\n| :-- | :-- | --: |\n`)
    for (const entry of section.entries) {
      const warn = entry.remainingPercent !== undefined && entry.remainingPercent < 20 ? '$(warning) ' : ''
      md.appendMarkdown(`| ${entry.name} | ${gaugeBar(entry.remainingPercent)} | ${warn}${formatPercent(entry.remainingPercent)} |\n`)
    }
    md.appendMarkdown('\n')
  }
  return md
}

// Filled blocks only, in their own table column: with no empty-track glyph the bar can never
// out-width itself, so the column borders stay straight. The percent sits in its own right-aligned column.
function gaugeBar(percent: number | undefined): string {
  const filled = percent === undefined ? 0 : Math.round(percent / 10)
  return filled === 0 ? '' : `\`${'█'.repeat(filled)}\``
}
