import { LOGIN_PROVIDERS, ManagementClient } from '@src/cliproxy/api/management-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MANAGEMENT_URL = 'http://127.0.0.1:8317'
const MANAGEMENT_KEY = 'mgmt-key'

function createClient(): ManagementClient {
  return new ManagementClient(MANAGEMENT_URL, MANAGEMENT_KEY)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('management client', () => {
  it.each(['codex', 'devin', 'meta'])('requests the %s auth URL with the management bearer key', async (provider) => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async () => Response.json({ status: 'ok', url: 'https://login', state: 'oauth-state' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await expect(client.requestAuthUrl(provider)).resolves.toEqual({ url: 'https://login', state: 'oauth-state' })
    const request = fetchMock.mock.calls[0]![0]
    expect(request.url).toBe(`http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=${provider}&is_webui=true`)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe('Bearer mgmt-key')
  })

  it.each([
    [' ABCD-EFGH ', 'ABCD-EFGH'],
    ['', undefined],
    [42, undefined],
  ])('handles optional device code %s', async (userCode, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ url: 'https://login', state: 'meta-state', user_code: userCode })))
    const session = await createClient().requestAuthUrl('meta')
    expect(session.userCode).toBe(expected)
  })

  it('rejects auth URL responses without state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok', url: 'https://login' })))
    const client = createClient()

    await expect(client.requestAuthUrl('codex')).rejects.toThrow('CLIProxyAPI returned an invalid auth URL response.')
  })

  it.each([
    ['wait', { status: 'wait' }, { status: 'wait' }],
    ['ok', { status: 'ok' }, { status: 'ok' }],
    ['error', { status: 'error', error: 'access denied' }, { status: 'error', error: 'access denied' }],
  ] as const)('reads %s auth status', async (_name, response, expected) => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async () => Response.json(response))
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await expect(client.getAuthStatus('state value')).resolves.toEqual(expected)
    expect(fetchMock.mock.calls[0]![0].url).toBe('http://127.0.0.1:8317/v8/management/oauth/status?state=state%20value')
  })

  it('rejects malformed auth status responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'done' })))
    const client = createClient()

    await expect(client.getAuthStatus('state')).rejects.toThrow('CLIProxyAPI returned an invalid auth status response.')
  })

  it('cancels an auth session and lists registered auth models', async () => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async (request) => {
      if (request.method === 'DELETE')
        return Response.json({ status: 'ok' })
      return Response.json({ models: [{ id: 'gpt-5.5' }, { id: 'claude-opus-4-8' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await client.cancelAuthSession('state value')
    await expect(client.listAuthFileModels('codex user.json')).resolves.toEqual(['gpt-5.5', 'claude-opus-4-8'])
    expect(fetchMock.mock.calls[0]![0].url).toBe('http://127.0.0.1:8317/v8/management/oauth/session?state=state%20value')
    expect(fetchMock.mock.calls[1]![0].url).toBe('http://127.0.0.1:8317/v8/management/credentials/models?name=codex%20user.json')
  })

  it('lists auth files defensively and skips malformed entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      files: [{ name: 'a.json', type: 'codex' }, { size: 1 }, { name: 'b.json' }],
    })))
    const client = createClient()

    await expect(client.listAuthFiles()).resolves.toEqual([
      { name: 'a.json', type: 'codex' },
      { name: 'b.json' },
    ])
  })

  it.each([
    ['reads the exposed server version', { 'X-CPA-VERSION': '8.0.3' }, '8.0.3'],
    ['returns undefined without a version header', undefined, undefined],
  ] as const)('%s', async (_name, headers, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: [] }, headers === undefined ? {} : { headers })))
    const client = createClient()

    await expect(client.serverVersion()).resolves.toBe(expected)
  })

  it('encodes the account name when deleting', async () => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await client.deleteAuthFile('my account.json')
    const request = fetchMock.mock.calls[0]![0]
    expect(request.url).toBe('http://127.0.0.1:8317/v8/management/credentials?name=my%20account.json')
    expect(request.method).toBe('DELETE')
  })

  it('surfaces management errors with their message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid key' }, { status: 401 })))
    const client = createClient()

    await expect(client.listAuthFiles()).rejects.toMatchObject({ message: 'invalid key' })
  })

  it('retries transient local api-call failures with ky', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://127.0.0.1:8317/v8/management/requests/api-call')
      attempts++
      return attempts < 3
        ? Response.json({ error: 'busy' }, { status: 503 })
        : Response.json({ status_code: 200, body: '{}' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await expect(client.apiCall({ auth_index: 'a1', method: 'GET', url: 'https://example.com' })).resolves.toEqual({
      statusCode: 200,
      header: {},
      body: '{}',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('exposes the supported login providers in picker order', () => {
    expect(LOGIN_PROVIDERS.map(provider => provider.provider)).toEqual([
      'codex',
      'claude',
      'antigravity',
      'kimi',
      'xai',
      'devin',
      'meta',
    ])
  })

  it('treats a missing openai-compatibility section as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })))

    await expect(createClient().listOpenAICompatibility()).resolves.toEqual([])
  })

  it('lists and replaces openai-compatibility providers', async () => {
    let putBody: unknown
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async (request) => {
      if (request.method === 'GET') {
        return Response.json([
          { 'name': 'opencode.ai', 'base-url': 'https://opencode.ai/v1', 'models': [{ name: 'gpt-5.5' }] },
          { broken: true },
        ])
      }
      if (request.method === 'PUT')
        putBody = await request.json()
      return Response.json({ status: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createClient()

    await expect(client.listOpenAICompatibility()).resolves.toEqual([
      { 'name': 'opencode.ai', 'base-url': 'https://opencode.ai/v1', 'models': [{ name: 'gpt-5.5' }] },
    ])

    const providers = [
      {
        'name': 'opencode.ai',
        'base-url': 'https://opencode.ai/v1',
        'keys': [{ 'api-key': 'sk' }],
        'models': [{ name: 'gpt-5.5' }],
      },
    ]
    await client.putOpenAICompatibility(providers)
    expect(fetchMock.mock.calls[0]![0].url).toBe('http://127.0.0.1:8317/v8/management/config/api-keys/openai-compatibility')
    const put = fetchMock.mock.calls[1]![0]
    expect(put.url).toBe('http://127.0.0.1:8317/v8/management/config/api-keys/openai-compatibility')
    expect(put.method).toBe('PUT')
    expect(putBody).toEqual(providers)
  })
})
