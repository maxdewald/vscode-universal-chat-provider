import type { QuickPickItem } from 'vscode'
import { window } from 'vscode'
import { formatPercent } from '../cliproxy/quota'

export interface QuotaEntry {
  name: string
  remainingPercent: number | undefined
  resetsAt?: number
}

export interface QuotaSection {
  title: string
  entries: QuotaEntry[]
}

export interface QuotaSource {
  quotaSections: () => QuotaSection[]
}

// Opens instantly with a loading spinner, then fills in once the refresh resolves — so the
// menu never blocks on the per-account network round-trips and never shows stale numbers.
export async function showQuotaMenu(source: QuotaSource, refresh: () => Promise<void>): Promise<void> {
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
  picker.items = buildItems(source.quotaSections())
  picker.placeholder = 'Remaining quota'
  picker.busy = false
}

function buildItems(sections: QuotaSection[]): QuickPickItem[] {
  const items = sections.flatMap(section =>
    section.entries.map(entry => ({
      label: `${section.title} · ${entry.name} — ${formatRemaining(entry.remainingPercent)}${formatResetSuffix(entry.resetsAt)}`,
    })),
  )
  return items.length > 0 ? items : [{ label: 'No model quota information is available yet.' }]
}

function formatRemaining(percent: number | undefined): string {
  return percent === undefined ? 'unknown' : `${formatPercent(percent)} left`
}

function formatResetSuffix(resetsAt: number | undefined): string {
  const delta = (resetsAt ?? 0) - Date.now()
  return delta > 0 ? ` · resets in ${formatDuration(delta)}` : ''
}

// Compact countdown: the two largest non-zero units up to days, e.g. "3d 4h", "3h 25m", "12m", "soon".
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1)
    return 'soon'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0)
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}
