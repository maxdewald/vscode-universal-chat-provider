import type { ProviderModel } from '@src/chat/models/model'
import type { ServerController } from '@src/cliproxy/controller'
import type { CodexResetOption } from '@src/cliproxy/quota/codex-resets'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import type { ExtensionContext } from 'vscode'
import { QUOTA_PROVIDERS } from '@src/cliproxy/quota/providers'
import { formatPercent, formatResetCountdown, quotaProviderForModel } from '@src/cliproxy/quota/quota'
import { commands, ConfigurationTarget, window, workspace } from 'vscode'

const MINUTE = 60_000
const SHOWN_KEY = 'universalChatProvider.fastModeNudges'
const SETTING = 'models.suggestFastMode'

export function fastModeQuota(model: ProviderModel, reports: readonly QuotaReport[]): QuotaReport | undefined {
  if (model.serviceTier !== undefined)
    return undefined
  const provider = quotaProviderForModel(model)
  if (provider === undefined)
    return undefined
  const now = Date.now()
  const accounts = reports.filter(report => report.provider === provider)
  const report = accounts.length === 1 ? accounts[0] : undefined
  if (report?.account === undefined || report.error !== undefined || report.updatedAt === undefined
    || report.updatedAt > now || now - report.updatedAt > 20 * MINUTE
    || (QUOTA_PROVIDERS[provider].remaining(report, model.proxyModelId) ?? 0) < 20) {
    return undefined
  }
  return report
}

export function fastModeOpportunity(
  model: ProviderModel,
  report: QuotaReport,
  resets: readonly CodexResetOption[] = [],
): { kind: 'quota' | 'credit', id: string, reason: string } | undefined {
  const now = Date.now()
  const source = QUOTA_PROVIDERS[report.provider]
  const quota = report.windows.find((quota) => {
    const remaining = source.remaining({ ...report, windows: [quota] }, model.proxyModelId)
    const horizon = quota.label.startsWith('5h') ? 45 * MINUTE : quota.label.startsWith('7d') ? 180 * MINUTE : 0
    const untilReset = (quota.resetsAt ?? 0) - now
    return remaining !== undefined && remaining >= 50 && untilReset > 0 && untilReset <= horizon
  })
  if (quota !== undefined) {
    return {
      kind: 'quota',
      id: `${quota.key ?? quota.label}:${quota.resetsAt}`,
      reason: `${formatPercent(quota.remainingPercent)} of ${quota.label.toLowerCase()} unused, resets in ${formatResetCountdown(quota.resetsAt)}`,
    }
  }
  if ((source.remaining(report, model.proxyModelId) ?? 0) < 50)
    return undefined
  const reset = resets.find(option => option.account.authIndex === report.account?.authIndex
    && option.availableCount > 0 && option.credit.expiresAt !== undefined
    && option.credit.expiresAt > now && option.credit.expiresAt - now <= 180 * MINUTE)
  return reset === undefined
    ? undefined
    : {
        kind: 'credit',
        id: reset.credit.id,
        reason: `unused reset credit expires in ${formatResetCountdown(reset.credit.expiresAt)}, ${formatPercent(source.remaining(report, model.proxyModelId))} quota left`,
      }
}

export function createFastModeNudge(context: ExtensionContext, readers: Pick<ServerController, 'listCodexResets' | 'listClaudeResets'>) {
  const cache = new Map<string, { until: number, resets: CodexResetOption[] }>()
  const listResets: Partial<Record<QuotaReport['provider'], () => Promise<CodexResetOption[]>>> = {
    codex: async () => readers.listCodexResets(),
    claude: async () => readers.listClaudeResets(),
  }
  let busy = false
  let latestModel: ProviderModel | undefined
  return async (model: ProviderModel, fastModel: ProviderModel | undefined, reports: readonly QuotaReport[]): Promise<void> => {
    latestModel = model
    if (busy || fastModel === undefined || !workspace.getConfiguration('universalChatProvider').get<boolean>(SETTING, true))
      return
    const report = fastModeQuota(model, reports)
    if (report === undefined)
      return
    busy = true
    try {
      let opportunity = fastModeOpportunity(model, report)
      if (opportunity === undefined && (QUOTA_PROVIDERS[report.provider].remaining(report, model.proxyModelId) ?? 0) >= 50) {
        let cached = cache.get(report.provider)
        if (cached === undefined || cached.until <= Date.now()) {
          const resets = await listResets[report.provider]?.().catch(() => []) ?? []
          cached = { until: Date.now() + 5 * MINUTE, resets }
          cache.set(report.provider, cached)
        }
        opportunity = fastModeOpportunity(model, report, cached.resets)
      }
      if (opportunity === undefined || latestModel !== model || fastModeQuota(model, reports) === undefined
        || !workspace.getConfiguration('universalChatProvider').get<boolean>(SETTING, true)) {
        return
      }
      const key = `${report.provider}:${report.account!.authIndex}:${opportunity.kind}`
      const shown = context.globalState.get<Record<string, string>>(SHOWN_KEY, {})
      if (shown[key] === opportunity.id)
        return
      await context.globalState.update(SHOWN_KEY, { ...shown, [key]: opportunity.id })
      const view = 'View Quota & Resets'
      const disable = 'Don\'t Suggest Again'
      const choice = await window.showInformationMessage(
        `${report.account!.label}: ${opportunity.reason}. Consider ${fastModel.name}: faster, but uses more quota.`,
        view,
        disable,
      )
      if (choice === view)
        await commands.executeCommand('universalChatProvider.showQuota')
      else if (choice === disable)
        await workspace.getConfiguration('universalChatProvider').update(SETTING, false, ConfigurationTarget.Global)
    }
    finally {
      busy = false
    }
  }
}
