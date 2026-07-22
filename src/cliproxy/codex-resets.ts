import type { AuthFileRaw, ManagementClient } from './management-client'
import { Type } from '@sinclair/typebox'
import { asJsonValue, asValue } from '../shared/json'

const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const CONSUME_RESET_CREDIT_URL = `${RESET_CREDITS_URL}/consume`
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

export interface CodexResetOption {
  account: { authIndex: string, label: string, accountId?: string }
  credit: { id: string, expiresAt?: number }
  availableCount: number
  hasRemainingUsage?: boolean
}

export type CodexResetOutcome = 'success' | 'nothingToReset' | 'noCredit' | 'failed'

const CreditSchema = Type.Object({
  status: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  expires_at: Type.Optional(Type.String()),
})

const ResetCreditsBodySchema = Type.Object({
  credits: Type.Optional(Type.Array(Type.Unknown())),
  available_count: Type.Optional(Type.Number()),
})

const RateLimitWindowSchema = Type.Object({
  used_percent: Type.Optional(Type.Number()),
})

const RateLimitBodySchema = Type.Object({
  primary_window: Type.Optional(RateLimitWindowSchema),
  secondary_window: Type.Optional(RateLimitWindowSchema),
})

const UsageBodySchema = Type.Object({
  rate_limit: Type.Optional(RateLimitBodySchema),
})

const ConsumeBodySchema = Type.Object({
  code: Type.Optional(Type.String()),
})

export async function listCodexResets(client: ManagementClient, signal?: AbortSignal): Promise<CodexResetOption[]> {
  const accounts = (await client.listAuthFilesRaw(signal)).flatMap(toCodexAccount)
  const options = await Promise.all(accounts.map(async (account) => {
    try {
      const response = await client.apiCall({
        auth_index: account.authIndex,
        method: 'GET',
        url: RESET_CREDITS_URL,
        header: headers(account),
      }, signal)
      if (response.statusCode < 200 || response.statusCode >= 300)
        return undefined
      const body = asJsonValue(ResetCreditsBodySchema, response.body)
      if (body === undefined)
        return undefined
      const credits = parseCredits(body.credits)
      const credit = credits[0]
      if (credit === undefined)
        return undefined
      const hasRemainingUsage = await fetchHasRemainingUsage(client, account, signal)
      const option: CodexResetOption = {
        account,
        credit,
        availableCount: Math.max(body.available_count ?? credits.length, credits.length),
        ...(hasRemainingUsage ? { hasRemainingUsage } : {}),
      }
      return option
    }
    catch {
      return undefined
    }
  }))
  return options.filter((option): option is CodexResetOption => option !== undefined)
}

async function fetchHasRemainingUsage(
  client: ManagementClient,
  account: CodexResetOption['account'],
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await client.apiCall({
      auth_index: account.authIndex,
      method: 'GET',
      url: USAGE_URL,
      header: headers(account),
    }, signal)
    if (response.statusCode < 200 || response.statusCode >= 300)
      return false
    const rateLimit = asJsonValue(UsageBodySchema, response.body)?.rate_limit
    if (rateLimit === undefined)
      return false
    return [rateLimit.primary_window, rateLimit.secondary_window]
      .some(window => window !== undefined && (window.used_percent ?? 100) < 100)
  }
  catch {
    return false
  }
}

export async function claimCodexReset(
  client: ManagementClient,
  option: CodexResetOption,
  redeemRequestId: string,
  signal?: AbortSignal,
): Promise<CodexResetOutcome> {
  try {
    const response = await client.apiCall({
      auth_index: option.account.authIndex,
      method: 'POST',
      url: CONSUME_RESET_CREDIT_URL,
      header: { ...headers(option.account), 'Content-Type': 'application/json' },
      data: JSON.stringify({ redeem_request_id: redeemRequestId, credit_id: option.credit.id }),
    }, signal)
    if (response.statusCode < 200 || response.statusCode >= 300)
      return 'failed'
    const code = asJsonValue(ConsumeBodySchema, response.body)?.code
    if (code === 'reset' || code === 'already_redeemed')
      return 'success'
    if (code === 'nothing_to_reset')
      return 'nothingToReset'
    if (code === 'no_credit')
      return 'noCredit'
    return 'failed'
  }
  catch {
    return 'failed'
  }
}

function toCodexAccount(entry: AuthFileRaw): Array<CodexResetOption['account']> {
  if ((entry.provider ?? entry.type ?? '').trim().toLowerCase() !== 'codex')
    return []
  const authIndex = entry.auth_index?.trim() ?? ''
  if (authIndex === '')
    return []
  const label = entry.email?.trim() ?? entry.label?.trim() ?? entry.name?.trim() ?? 'Codex account'
  const accountId = entry.chatgpt_account_id?.trim()
    ?? entry.account_id?.trim()
    ?? entry.id_token?.chatgpt_account_id?.trim()
    ?? ''
  return [{ authIndex, label, ...(accountId === '' ? {} : { accountId }) }]
}

function headers(account: CodexResetOption['account']): Record<string, string> {
  return {
    'Authorization': 'Bearer $TOKEN$',
    'Accept': 'application/json',
    'OpenAI-Beta': 'codex-1',
    'originator': 'Codex Desktop',
    ...(account.accountId === undefined ? {} : { 'ChatGPT-Account-Id': account.accountId }),
  }
}

function parseCredits(value: unknown[] | undefined): Array<CodexResetOption['credit']> {
  if (value === undefined)
    return []
  return value.flatMap((rawValue) => {
    const raw = asValue(CreditSchema, rawValue)
    if (raw === undefined || (raw.status !== undefined && raw.status !== 'available'))
      return []
    const id = raw.id?.trim() ?? ''
    if (id === '')
      return []
    const expiresAt = timestamp(raw.expires_at)
    return [{ id, ...(expiresAt === undefined ? {} : { expiresAt }) }]
  }).sort((left, right) => (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY))
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined)
    return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}
