import type { QuickInputButton, QuickPickItem } from 'vscode'
import type { CodexResetOption, CodexResetOutcome } from '../cliproxy/codex-resets'
import { randomUUID } from 'node:crypto'
import { QuickPickItemKind, ThemeIcon, window } from 'vscode'
import { formatPercent, formatResetCountdown } from '../cliproxy/quota'

export interface QuotaEntry {
  name: string
  remainingPercent: number | undefined
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

const USE_RESET_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon('debug-restart'),
  tooltip: 'Use next reset',
}

// Opens instantly with a loading spinner, then fills in once the refresh resolves — so the
// menu never blocks on the per-account network round-trips and never shows stale numbers.
export async function showQuotaMenu(
  getSections: () => QuotaSection[],
  refresh: () => Promise<void>,
  resets?: CodexResetActions,
): Promise<void> {
  const picker = window.createQuickPick<QuotaPickerItem>()
  picker.title = 'Model Quota'
  picker.placeholder = 'Loading quota…'
  picker.busy = true
  picker.show()
  let open = true
  let resetOptions: CodexResetOption[] = []
  let claiming = false
  const retries = new Map<string, { creditId: string, redeemRequestId: string }>()
  const useReset = async (item: QuotaPickerItem): Promise<void> => {
    if (item.reset === undefined || claiming)
      return
    claiming = true
    const option = item.reset
    const confirmAction = option.hasRemainingUsage ? 'Use Reset Anyway' : 'Use Reset'
    const confirm = await window.showWarningMessage(
      option.hasRemainingUsage
        ? `WARNING: ${option.account.label} still has usage remaining. Using a reset now discards that remaining usage and consumes one reset credit. This cannot be undone.`
        : `Use a Codex reset for ${option.account.label}? This immediately resets the account's current Codex usage limits and consumes one reset credit.`,
      { modal: true },
      confirmAction,
    )
    if (confirm !== confirmAction || !open) {
      claiming = false
      return
    }

    picker.busy = true
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
    if (open)
      picker.items = buildItems(getSections(), resetOptions)
    picker.busy = false
    claiming = false

    if (outcome === 'success')
      void window.showInformationMessage(`Codex usage reset for ${option.account.label}.`)
    else if (outcome === 'nothingToReset')
      void window.showInformationMessage(`${option.account.label}'s usage does not need a reset right now.`)
    else if (outcome === 'noCredit')
      void window.showWarningMessage('That Codex reset is no longer available.')
    else
      void window.showErrorMessage(`Could not reset Codex usage for ${option.account.label}. Try again.`)
  }
  picker.onDidAccept(() => {
    const item = picker.activeItems[0]
    if (item?.reset !== undefined)
      void useReset(item)
    else
      picker.hide()
  })
  picker.onDidTriggerItemButton(async ({ item }) => useReset(item))
  picker.onDidHide(() => {
    open = false
    picker.dispose()
  })

  await refresh().catch(() => {})
  resetOptions = await loadResets(resets)
  if (!open)
    return
  picker.items = buildItems(getSections(), resetOptions)
  picker.placeholder = 'Remaining quota'
  picker.busy = false
}

async function loadResets(actions: CodexResetActions | undefined): Promise<CodexResetOption[]> {
  return actions === undefined ? [] : actions.listCodexResets().catch(() => [])
}

function buildItems(sections: QuotaSection[], resets: CodexResetOption[]): QuotaPickerItem[] {
  const grouped = new Map<string, QuotaPickerItem[]>()
  for (const section of sections) {
    const items = grouped.get(section.title) ?? []
    items.push(...section.entries.map((entry) => {
      const remaining = entry.remainingPercent === undefined ? 'unknown' : `${formatPercent(entry.remainingPercent)} left`
      const countdown = formatResetCountdown(entry.resetsAt)
      return { label: `${section.title} · ${entry.name} — ${remaining}`, ...(countdown === undefined ? {} : { description: `resets in ${countdown}` }) }
    }))
    grouped.set(section.title, items)
  }
  const codex = grouped.get('Codex') ?? []
  codex.push(...resets.map(option => ({
    label: `Codex · ${option.account.label} — ${option.availableCount} ${option.availableCount === 1 ? 'reset' : 'resets'} available`,
    description: option.credit.expiresAt === undefined ? 'Next reset does not expire' : `Next reset expires ${new Date(option.credit.expiresAt).toLocaleString()}`,
    buttons: [USE_RESET_BUTTON],
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
