import type { ClaudeResetOption } from '@src/cliproxy/quota/claude-resets'
import type { CodexResetOption, ResetOutcome } from '@src/cliproxy/quota/codex-resets'
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

export interface ResetActions {
  listCodexResets: () => Promise<CodexResetOption[]>
  claimCodexReset: (option: CodexResetOption, redeemRequestId: string) => Promise<ResetOutcome>
  listClaudeResets: () => Promise<ClaudeResetOption[]>
  claimClaudeReset: (option: ClaudeResetOption, requestId: string) => Promise<ResetOutcome>
}

interface ResetEntry {
  title: 'Codex' | 'Claude'
  option: CodexResetOption | ClaudeResetOption
  claim: (requestId: string) => Promise<ResetOutcome>
}

type QuotaPickerItem = QuickPickItem & { reset?: ResetEntry }

export async function showQuotaMenu(
  getSections: () => QuotaSection[],
  refresh: () => Promise<void>,
  resets?: ResetActions,
): Promise<void> {
  await refresh().catch(() => {})
  let resetEntries = await loadResets(resets)
  const retries = new Map<string, { creditId: string, redeemRequestId: string }>()

  while (true) {
    const item = await window.showQuickPick(buildItems(getSections(), resetEntries), {
      title: 'Model Quota',
      placeHolder: 'Select a reset or press Escape to close',
    })
    const entry = item?.reset
    if (entry === undefined)
      return
    const { title, option } = entry
    const confirmAction = option.hasRemainingUsage ? 'Use Reset Anyway' : 'Use Reset'
    const confirm = await window.showWarningMessage(
      option.hasRemainingUsage
        ? `WARNING: ${option.account.label} still has usage remaining. Using a reset now discards that remaining usage and consumes one reset credit. This cannot be undone.`
        : `Use a ${title} reset for ${option.account.label}? This immediately resets the account's current ${title} usage limits and consumes one reset credit.`,
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
    const outcome = await entry.claim(attempt.redeemRequestId)
    if (outcome !== 'failed')
      retries.delete(option.account.authIndex)
    if (outcome === 'success' || outcome === 'noCredit')
      resetEntries = await loadResets(resets)

    if (outcome === 'success')
      void window.showInformationMessage(`${title} usage reset for ${option.account.label}.`)
    else if (outcome === 'nothingToReset')
      void window.showInformationMessage(`${option.account.label}'s usage does not need a reset right now.`)
    else if (outcome === 'noCredit')
      void window.showWarningMessage(`That ${title} reset is no longer available.`)
    else
      void window.showErrorMessage(`Could not reset ${title} usage for ${option.account.label}. Try again.`)
  }
}

async function loadResets(actions: ResetActions | undefined): Promise<ResetEntry[]> {
  if (actions === undefined)
    return []
  const [codex, claude] = await Promise.all([
    actions.listCodexResets().catch(() => []),
    actions.listClaudeResets().catch(() => []),
  ])
  return [
    ...codex.map(option => ({ title: 'Codex' as const, option, claim: async (id: string) => actions.claimCodexReset(option, id) })),
    ...claude.map(option => ({ title: 'Claude' as const, option, claim: async (id: string) => actions.claimClaudeReset(option, id) })),
  ]
}

function buildItems(sections: QuotaSection[], resets: ResetEntry[]): QuotaPickerItem[] {
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
  for (const entry of resets) {
    const { title, option } = entry
    const blocker = 'blocker' in option ? option.blocker : undefined
    const items = grouped.get(title) ?? []
    items.push({
      label: `${title} · ${option.account.label} — ${option.availableCount} ${option.availableCount === 1 ? 'reset' : 'resets'} available`,
      ...(blocker === undefined
        ? { description: option.credit.expiresAt === undefined ? 'Next reset does not expire' : `Next reset expires ${formatExpiration(option.credit.expiresAt)}`, reset: entry }
        : { description: blocker }),
    })
    grouped.set(title, items)
  }
  const items = [...grouped.values()].flatMap((entries, index) => [
    ...(index === 0 ? [] : [{ label: '', kind: QuickPickItemKind.Separator }]),
    ...entries,
  ])
  return items.length > 0 ? items : [{ label: 'No model quota information is available yet.' }]
}

export function formatQuotaRemaining(entry: QuotaEntry, fallback = 'loading…', percentSuffix = ' left'): string {
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
