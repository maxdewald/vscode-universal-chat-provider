import type { CodexResetOption, CodexResetOutcome } from '@src/cliproxy/quota/codex-resets'
import type { QuickPickItem } from 'vscode'
import { randomUUID } from 'node:crypto'
import { formatPercent, formatResetCountdown } from '@src/cliproxy/quota/quota'
import { env, QuickPickItemKind, window } from 'vscode'

export interface QuotaEntry {
  name: string
  remainingPercent: number | undefined
  balance?: { amount: number, currency: string, suffix: 'left' | 'used' }
  resetsAt?: number
}

export interface QuotaSection {
  title: string
  entries: QuotaEntry[]
}

export interface CodexResetActions {
  listCodexResets: () => Promise<CodexResetOption[]>
  claimCodexReset: (option: CodexResetOption, redeemRequestId: string) => Promise<CodexResetOutcome>
}

type QuotaPickerItem = QuickPickItem & { reset?: CodexResetOption }

export async function showQuotaMenu(
  getSections: () => QuotaSection[],
  refresh: () => Promise<void>,
  resets?: CodexResetActions,
): Promise<void> {
  await refresh().catch(() => {})
  let resetOptions = await loadResets(resets)
  const retries = new Map<string, { creditId: string, redeemRequestId: string }>()

  while (true) {
    const item = await window.showQuickPick(buildItems(getSections(), resetOptions), {
      title: 'Model Quota',
      placeHolder: 'Select a Codex reset or press Escape to close',
    })
    const option = item?.reset
    if (option === undefined)
      return
    const confirmAction = option.hasRemainingUsage ? 'Use Reset Anyway' : 'Use Reset'
    const confirm = await window.showWarningMessage(
      option.hasRemainingUsage
        ? `WARNING: ${option.account.label} still has usage remaining. Using a reset now discards that remaining usage and consumes one reset credit. This cannot be undone.`
        : `Use a Codex reset for ${option.account.label}? This immediately resets the account's current Codex usage limits and consumes one reset credit.`,
      { modal: true },
      confirmAction,
    )
    if (confirm !== confirmAction)
      continue
    const previous = retries.get(option.account.authIndex)
    const attempt = previous?.creditId === option.credit.id
      ? previous
      : { creditId: option.credit.id, redeemRequestId: randomUUID() }
    retries.set(option.account.authIndex, attempt)
    const outcome = await resets?.claimCodexReset(option, attempt.redeemRequestId) ?? 'failed'
    if (outcome !== 'failed')
      retries.delete(option.account.authIndex)
    if (outcome === 'success' || outcome === 'noCredit')
      resetOptions = await loadResets(resets)

    if (outcome === 'success')
      void window.showInformationMessage(`Codex usage reset for ${option.account.label}.`)
    else if (outcome === 'nothingToReset')
      void window.showInformationMessage(`${option.account.label}'s usage does not need a reset right now.`)
    else if (outcome === 'noCredit')
      void window.showWarningMessage('That Codex reset is no longer available.')
    else
      void window.showErrorMessage(`Could not reset Codex usage for ${option.account.label}. Try again.`)
  }
}

async function loadResets(actions: CodexResetActions | undefined): Promise<CodexResetOption[]> {
  return actions === undefined ? [] : actions.listCodexResets().catch(() => [])
}

function buildItems(sections: QuotaSection[], resets: CodexResetOption[]): QuotaPickerItem[] {
  const grouped = new Map<string, QuotaPickerItem[]>()
  for (const section of sections) {
    const items = grouped.get(section.title) ?? []
    items.push(...section.entries.map((entry) => {
      const remaining = formatQuotaRemaining(entry)
      const countdown = formatResetCountdown(entry.resetsAt)
      return { label: `${section.title} · ${entry.name} — ${remaining}`, ...(countdown === undefined ? {} : { description: `resets in ${countdown}` }) }
    }))
    grouped.set(section.title, items)
  }
  const codex = grouped.get('Codex') ?? []
  codex.push(...resets.map(option => ({
    label: `Codex · ${option.account.label} — ${option.availableCount} ${option.availableCount === 1 ? 'reset' : 'resets'} available`,
    description: option.credit.expiresAt === undefined ? 'Next reset does not expire' : `Next reset expires ${formatExpiration(option.credit.expiresAt)}`,
    reset: option,
  })))
  if (codex.length > 0)
    grouped.set('Codex', codex)
  const items = [...grouped.values()].flatMap((entries, index) => [
    ...(index === 0 ? [] : [{ label: '', kind: QuickPickItemKind.Separator }]),
    ...entries,
  ])
  return items.length > 0 ? items : [{ label: 'No model quota information is available yet.' }]
}

export function formatQuotaRemaining(entry: QuotaEntry, fallback = 'unknown', percentSuffix = ' left'): string {
  const percent = entry.remainingPercent === undefined ? undefined : `${formatPercent(entry.remainingPercent)}${percentSuffix}`
  if (entry.balance !== undefined) {
    const balance = `${formatCurrency(entry.balance)} ${entry.balance.suffix}`
    return percent === undefined || entry.balance.suffix === 'used' ? balance : `${balance} (${percent})`
  }
  return percent ?? fallback
}

function formatCurrency(balance: { amount: number, currency: string }): string {
  return new Intl.NumberFormat(env.language, { style: 'currency', currency: balance.currency }).format(balance.amount)
}

function formatExpiration(expiresAt: number): string {
  return new Intl.DateTimeFormat(env.language, { dateStyle: 'medium', timeStyle: 'short' }).format(expiresAt)
}
