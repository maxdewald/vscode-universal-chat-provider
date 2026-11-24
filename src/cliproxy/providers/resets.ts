import type { AuthFileRaw } from '@src/cliproxy/api/management-client'

export type ResetOutcome = 'success' | 'nothingToReset' | 'noCredit' | 'failed'

export function authAccount(entry: AuthFileRaw, provider: string, fallbackLabel: string): Array<{ authIndex: string, label: string }> {
  if ((entry.provider ?? entry.type ?? '').trim().toLowerCase() !== provider)
    return []
  const authIndex = entry.auth_index?.trim() ?? ''
  if (authIndex === '')
    return []
  return [{ authIndex, label: entry.email?.trim() ?? entry.label?.trim() ?? entry.name?.trim() ?? fallbackLabel }]
}
