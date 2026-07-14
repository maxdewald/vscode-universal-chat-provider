import type { QuickPickItem } from 'vscode'
import { window } from 'vscode'
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

// Opens instantly with a loading spinner, then fills in once the refresh resolves — so the
// menu never blocks on the per-account network round-trips and never shows stale numbers.
export async function showQuotaMenu(getSections: () => QuotaSection[], refresh: () => Promise<void>): Promise<void> {
  const picker = window.createQuickPick()
  picker.title = 'Model Quota'
  picker.placeholder = 'Loading quota…'
  picker.busy = true
  picker.show()
  let open = true
  picker.onDidAccept(() => picker.hide())
  picker.onDidHide(() => {
    open = false
    picker.dispose()
  })

  await refresh().catch(() => {})
  if (!open)
    return
  picker.items = buildItems(getSections())
  picker.placeholder = 'Remaining quota'
  picker.busy = false
}

function buildItems(sections: QuotaSection[]): QuickPickItem[] {
  const items = sections.flatMap(section =>
    section.entries.map((entry) => {
      const remaining = entry.remainingPercent === undefined ? 'unknown' : `${formatPercent(entry.remainingPercent)} left`
      const countdown = formatResetCountdown(entry.resetsAt)
      return { label: `${section.title} · ${entry.name} — ${remaining}${countdown === undefined ? '' : ` · resets in ${countdown}`}` }
    }),
  )
  return items.length > 0 ? items : [{ label: 'No model quota information is available yet.' }]
}
