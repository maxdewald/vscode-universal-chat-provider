import { describe, expect, it } from 'vitest'
import { claimCodexReset, listCodexResets } from '../../../src/cliproxy/quota/codex-resets'
import { createManagementClientFake, queuedApiCallResponses } from '../support/management'

describe('codex reset credits', () => {
  it('lists the soonest available reset for each Codex account', async () => {
    const { client, apiCall } = createManagementClientFake([
      { provider: 'codex', auth_index: 'codex-1', email: 'one@example.com', id_token: { chatgpt_account_id: 'acct-1' } },
      { type: 'claude', auth_index: 'claude-1' },
    ], queuedApiCallResponses([{
      statusCode: 200,
      body: JSON.stringify({
        available_count: 3,
        credits: [
          { id: 'never', status: 'available', expires_at: null },
          { id: 'later', status: 'available', expires_at: '2026-08-01T00:00:00Z' },
          { id: 'used', status: 'redeemed', expires_at: '2026-07-01T00:00:00Z' },
          { id: 'next', status: 'available', expires_at: '2026-07-20T00:00:00Z' },
        ],
      }),
    }, {
      statusCode: 200,
      body: JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 75, limit_window_seconds: 18_000 },
          secondary_window: { used_percent: 100, limit_window_seconds: 604_800 },
        },
      }),
    }]))

    await expect(listCodexResets(client)).resolves.toEqual([{
      account: { authIndex: 'codex-1', label: 'one@example.com', accountId: 'acct-1' },
      credit: { id: 'next', expiresAt: Date.parse('2026-07-20T00:00:00Z') },
      availableCount: 3,
      hasRemainingUsage: true,
    }])
    expect(apiCall).toHaveBeenCalledTimes(2)
    expect(apiCall.mock.calls[0]![0]).toEqual({
      auth_index: 'codex-1',
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      header: {
        'Authorization': 'Bearer $TOKEN$',
        'Accept': 'application/json',
        'ChatGPT-Account-Id': 'acct-1',
        'OpenAI-Beta': 'codex-1',
        'originator': 'Codex Desktop',
      },
    })
    expect(apiCall.mock.calls[1]![0]).toMatchObject({
      auth_index: 'codex-1',
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
    })
  })

  it('omits accounts without an explicit available credit', async () => {
    const { client } = createManagementClientFake([
      { provider: 'codex', auth_index: 'codex-1', name: 'codex.json' },
      { provider: 'codex', name: 'missing-index.json' },
    ], queuedApiCallResponses([{ statusCode: 200, body: '{"available_count":2,"credits":[]}' }]))

    await expect(listCodexResets(client)).resolves.toEqual([])
  })

  it.each([
    ['reset', 'success'],
    ['already_redeemed', 'success'],
    ['nothing_to_reset', 'nothingToReset'],
    ['no_credit', 'noCredit'],
    ['unknown', 'failed'],
  ] as const)('maps the %s consume response to %s', async (code, outcome) => {
    const { client, apiCall } = createManagementClientFake([], queuedApiCallResponses([
      { statusCode: 200, body: JSON.stringify({ code }) },
    ]))
    const option = {
      account: { authIndex: 'codex-1', label: 'one@example.com', accountId: 'acct-1' },
      credit: { id: 'credit-1' },
      availableCount: 1,
    }

    await expect(claimCodexReset(client, option, 'redeem-1')).resolves.toBe(outcome)
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall.mock.calls[0]![0]).toEqual({
      auth_index: 'codex-1',
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
      header: {
        'Authorization': 'Bearer $TOKEN$',
        'Accept': 'application/json',
        'OpenAI-Beta': 'codex-1',
        'originator': 'Codex Desktop',
        'Content-Type': 'application/json',
        'ChatGPT-Account-Id': 'acct-1',
      },
      data: JSON.stringify({ redeem_request_id: 'redeem-1', credit_id: 'credit-1' }),
    })
  })

  it('fails closed for transport, HTTP, and malformed responses', async () => {
    const option = {
      account: { authIndex: 'codex-1', label: 'one@example.com' },
      credit: { id: 'credit-1' },
      availableCount: 1,
    }
    await expect(claimCodexReset(createManagementClientFake([], queuedApiCallResponses([
      { statusCode: 503, body: '' },
    ])).client, option, 'redeem-1')).resolves.toBe('failed')
    await expect(claimCodexReset(createManagementClientFake([], queuedApiCallResponses([
      { statusCode: 200, body: 'nope' },
    ])).client, option, 'redeem-1')).resolves.toBe('failed')
  })
})
