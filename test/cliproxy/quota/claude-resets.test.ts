import { claimClaudeReset, listClaudeResets } from '@src/cliproxy/quota/claude-resets'
import { describe, expect, it } from 'vitest'
import { createManagementClientFake, queuedApiCallResponses } from '../support/management'

const HEADERS = {
  'Authorization': 'Bearer $TOKEN$',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': 'claude-cli/2.1.280 (external, cli)',
}
const ORG = '11111111-2222-3333-4444-555555555555'
const OPTION = { account: { authIndex: 'claude-1', label: 'one@example.com' }, credit: { id: 'grant-1' }, availableCount: 1 }

function usage(block: unknown): { statusCode: number, body: string } {
  return { statusCode: 200, body: JSON.stringify({ five_hour: { utilization: 100 }, cedar_ember: block }) }
}

const grant = { id: 'grant-1', resets_left: 1, resets_total: 1, usable_now: true, ends_at: '2099-01-01T00:00:00Z' }

describe('claude reset grants', () => {
  it('lists the recommended grant for each Claude account', async () => {
    const { client, apiCall } = createManagementClientFake([
      { provider: 'claude', auth_index: 'claude-1', email: 'one@example.com' },
      { provider: 'codex', auth_index: 'codex-1' },
    ], queuedApiCallResponses([usage({
      eligible: true,
      at_limit: true,
      next_grant_id: 'grant-2',
      grants: [grant, { ...grant, id: 'grant-2', resets_left: 2, resets_total: 2, ends_at: null }],
    })]))

    await expect(listClaudeResets(client)).resolves.toEqual([{
      account: { authIndex: 'claude-1', label: 'one@example.com' },
      credit: { id: 'grant-2' },
      availableCount: 3,
    }])
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall.mock.calls[0]![0]).toEqual({
      auth_index: 'claude-1',
      method: 'GET',
      url: 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1',
      header: HEADERS,
    })
  })

  it.each([
    ['not at a limit', { at_limit: false }, {}, 'Usable once you hit a usage limit'],
    ['on cooldown', { cooldown_until: '2099-01-01T00:00:00Z' }, {}, 'On cooldown, try again later'],
    ['not usable', {}, { usable_now: false }, 'Not usable right now'],
  ])('marks a grant %s as blocked', async (_, status, grantFields, blocker) => {
    const { client } = createManagementClientFake(
      [{ provider: 'claude', auth_index: 'claude-1' }],
      queuedApiCallResponses([usage({ eligible: true, at_limit: true, grants: [{ ...grant, ...grantFields }], ...status })]),
    )
    await expect(listClaudeResets(client)).resolves.toMatchObject([{ blocker }])
  })

  it('flags remaining usage when a grant does not require hitting the limit', async () => {
    const { client } = createManagementClientFake(
      [{ provider: 'claude', auth_index: 'claude-1' }],
      queuedApiCallResponses([usage({ eligible: true, at_limit: false, grants: [{ ...grant, use_requires_limit: false }] })]),
    )
    await expect(listClaudeResets(client)).resolves.toMatchObject([{ hasRemainingUsage: true }])
  })

  it.each([
    null,
    {},
    { eligible: false, grants: [grant] },
    { eligible: true, grants: [{ ...grant, resets_left: 0 }] },
    { eligible: true, grants: 'nope' },
  ])('omits accounts with an absent, ineligible, exhausted, or malformed block (%j)', async (block) => {
    const { client } = createManagementClientFake(
      [{ provider: 'claude', auth_index: 'claude-1' }],
      queuedApiCallResponses([usage(block)]),
    )
    await expect(listClaudeResets(client)).resolves.toEqual([])
  })

  it.each([
    ['reset', 'success'],
    ['not_limited', 'nothingToReset'],
    ['already_used', 'noCredit'],
    ['cooldown', 'noCredit'],
    ['unavailable', 'noCredit'],
    ['ineligible', 'noCredit'],
    ['unexpected', 'failed'],
  ] as const)('maps the %s claim result to %s', async (result, outcome) => {
    const { client, apiCall } = createManagementClientFake([], queuedApiCallResponses([
      { statusCode: 200, body: JSON.stringify({ organization: { uuid: ORG.toUpperCase() } }) },
      { statusCode: 200, body: JSON.stringify({ result }) },
    ]))

    await expect(claimClaudeReset(client, OPTION, 'request-1')).resolves.toBe(outcome)
    expect(apiCall.mock.calls[0]![0]).toEqual({
      auth_index: 'claude-1',
      method: 'GET',
      url: 'https://api.anthropic.com/api/oauth/profile',
      header: HEADERS,
    })
    expect(apiCall.mock.calls[1]![0]).toEqual({
      auth_index: 'claude-1',
      method: 'POST',
      url: `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`,
      header: HEADERS,
      data: JSON.stringify({ program: 'cedar_ember', grant_id: 'grant-1', request_id: 'request-1' }),
    })
  })

  it('fails closed without claiming when the organization is missing or malformed', async () => {
    for (const body of ['{}', JSON.stringify({ organization: { uuid: '../../evil' } })]) {
      const { client, apiCall } = createManagementClientFake([], queuedApiCallResponses([{ statusCode: 200, body }]))
      await expect(claimClaudeReset(client, OPTION, 'request-1')).resolves.toBe('failed')
      expect(apiCall).toHaveBeenCalledTimes(1)
    }
  })

  it('fails on rate limits and HTTP errors from the claim', async () => {
    for (const statusCode of [429, 500]) {
      const { client } = createManagementClientFake([], queuedApiCallResponses([
        { statusCode: 200, body: JSON.stringify({ organization: { uuid: ORG } }) },
        { statusCode, body: '' },
      ]))
      await expect(claimClaudeReset(client, OPTION, 'request-1')).resolves.toBe('failed')
    }
  })
})
