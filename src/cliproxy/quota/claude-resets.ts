import type { ManagementClient } from '@src/cliproxy/api/management-client'
import type { ResetOutcome } from '@src/cliproxy/quota/codex-resets'
import { Type } from '@sinclair/typebox'
import { authAccount } from '@src/cliproxy/quota/codex-resets'
import { Nullable, parseReset } from '@src/cliproxy/quota/providers/types'
import { asJsonValue, asValue } from '@src/shared/json'

const API_ORIGIN = 'https://api.anthropic.com'
const STATUS_URL = `${API_ORIGIN}/api/oauth/usage?cedar_ember=1&skip_spend=1`
const PROFILE_URL = `${API_ORIGIN}/api/oauth/profile`
const HEADERS = {
  'Authorization': 'Bearer $TOKEN$',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
  // Reset eligibility is gated on the Claude Code client version (ineligible_reason: cli_version).
  'User-Agent': 'claude-cli/2.1.280 (external, cli)',
}

export interface ClaudeResetOption {
  account: { authIndex: string, label: string }
  credit: { id: string, expiresAt?: number }
  availableCount: number
  hasRemainingUsage?: boolean
  blocker?: string
}

const GrantSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  resets_left: Type.Integer({ minimum: 0 }),
  ends_at: Nullable(Type.String()),
  usable_now: Nullable(Type.Boolean()),
  use_requires_limit: Nullable(Type.Boolean()),
})

const StatusSchema = Type.Object({
  eligible: Type.Boolean(),
  at_limit: Nullable(Type.Boolean()),
  next_grant_id: Nullable(Type.String()),
  cooldown_until: Nullable(Type.String()),
  grants: Nullable(Type.Array(GrantSchema)),
})

const UsageBodySchema = Type.Object({
  cedar_ember: Nullable(Type.Unknown()),
})

const ProfileBodySchema = Type.Object({
  organization: Type.Object({
    uuid: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' }),
  }),
})

const CLAIM_OUTCOMES: Record<string, ResetOutcome> = {
  reset: 'success',
  not_limited: 'nothingToReset',
  already_used: 'noCredit',
  unavailable: 'noCredit',
  ineligible: 'noCredit',
  cooldown: 'noCredit',
}

export async function listClaudeResets(client: ManagementClient, signal?: AbortSignal): Promise<ClaudeResetOption[]> {
  const accounts = (await client.listAuthFilesRaw(signal)).flatMap(entry => authAccount(entry, 'claude', 'Claude account'))
  const options = await Promise.all(accounts.map(async (account) => {
    try {
      const response = await client.apiCall({ auth_index: account.authIndex, method: 'GET', url: STATUS_URL, header: HEADERS }, signal)
      if (response.statusCode < 200 || response.statusCode >= 300)
        return undefined
      const block = asJsonValue(UsageBodySchema, response.body)?.cedar_ember
      const status = block == null ? undefined : asValue(StatusSchema, block)
      return status === undefined ? undefined : toOption(account, status)
    }
    catch {
      return undefined
    }
  }))
  return options.filter((option): option is ClaudeResetOption => option !== undefined)
}

export async function claimClaudeReset(
  client: ManagementClient,
  option: ClaudeResetOption,
  requestId: string,
  signal?: AbortSignal,
): Promise<ResetOutcome> {
  const auth_index = option.account.authIndex
  try {
    const profile = await client.apiCall({ auth_index, method: 'GET', url: PROFILE_URL, header: HEADERS }, signal)
    const organization = asJsonValue(ProfileBodySchema, profile.body)?.organization.uuid.toLowerCase()
    if (profile.statusCode < 200 || profile.statusCode >= 300 || organization === undefined)
      return 'failed'
    const response = await client.apiCall({
      auth_index,
      method: 'POST',
      url: `${API_ORIGIN}/api/organizations/${organization}/reset_rate_limits`,
      header: HEADERS,
      data: JSON.stringify({ program: 'cedar_ember', grant_id: option.credit.id, request_id: requestId }),
    }, signal)
    if (response.statusCode < 200 || response.statusCode >= 300)
      return 'failed'
    const result = asJsonValue(Type.Object({ result: Type.Optional(Type.String()) }), response.body)?.result
    return CLAIM_OUTCOMES[result ?? ''] ?? 'failed'
  }
  catch {
    return 'failed'
  }
}

function toOption(account: ClaudeResetOption['account'], status: typeof StatusSchema.static): ClaudeResetOption | undefined {
  const grants = (status.grants ?? []).filter(grant => grant.resets_left > 0)
  const grant = grants.find(candidate => candidate.id === status.next_grant_id) ?? grants[0]
  if (!status.eligible || grant === undefined)
    return undefined
  const atLimit = status.at_limit ?? false
  const blocker = blockerOf(status, grant, atLimit)
  const expiresAt = parseReset(grant.ends_at)
  return {
    account,
    credit: { id: grant.id, ...(expiresAt === undefined ? {} : { expiresAt }) },
    availableCount: grants.reduce((sum, candidate) => sum + candidate.resets_left, 0),
    ...(blocker === undefined ? {} : { blocker }),
    ...(blocker === undefined && !atLimit ? { hasRemainingUsage: true } : {}),
  }
}

function blockerOf(status: typeof StatusSchema.static, grant: typeof GrantSchema.static, atLimit: boolean): string | undefined {
  if (parseReset(status.cooldown_until) !== undefined)
    return 'On cooldown, try again later'
  if ((grant.use_requires_limit ?? true) && !atLimit)
    return 'Usable once you hit a usage limit'
  if (grant.usable_now !== true)
    return 'Not usable right now'
  return undefined
}
