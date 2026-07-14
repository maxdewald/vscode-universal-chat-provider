import type { ManagementClient } from './management-client'
import { isPlainObject } from 'moderndash'

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
      const body = parseBody(response.body)
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
        availableCount: Math.max(number(body.available_count) ?? credits.length, credits.length),
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
    const rateLimit = parseBody(response.body)?.rate_limit
    if (!isPlainObject(rateLimit))
      return false
    return [rateLimit.primary_window, rateLimit.secondary_window]
      .some(raw => isPlainObject(raw) && (number(raw.used_percent) ?? 100) < 100)
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
    const code = parseBody(response.body)?.code
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

function toCodexAccount(entry: Record<string, unknown>): Array<CodexResetOption['account']> {
  if (string(entry.provider ?? entry.type).toLowerCase() !== 'codex')
    return []
  const authIndex = string(entry.auth_index)
  if (authIndex === '')
    return []
  const label = string(entry.email) || string(entry.label) || string(entry.name) || 'Codex account'
  const accountId = string(entry.chatgpt_account_id) || string(entry.account_id)
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

function parseCredits(value: unknown): Array<CodexResetOption['credit']> {
  if (!Array.isArray(value))
    return []
  return value.flatMap((raw) => {
    if (!isPlainObject(raw) || (typeof raw.status === 'string' && raw.status !== 'available'))
      return []
    const id = string(raw.id)
    if (id === '')
      return []
    const expiresAt = timestamp(raw.expires_at)
    return [{ id, ...(expiresAt === undefined ? {} : { expiresAt }) }]
  }).sort((left, right) => (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY))
}

function parseBody(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string')
    return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string')
    return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
