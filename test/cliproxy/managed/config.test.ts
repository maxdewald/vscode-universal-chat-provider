import { join } from 'node:path'
import { buildManagedConfig, generateSecret, managedPaths, parseExtraConfig } from '@src/cliproxy/managed/config'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('managed config', () => {
  it('derives all managed paths from a root directory', () => {
    const paths = managedPaths('/tmp/store')
    expect(paths).toEqual({
      root: '/tmp/store',
      binDir: join('/tmp/store', 'bin'),
      authDir: join('/tmp/store', 'auth'),
      configPath: join('/tmp/store', 'config.yaml'),
      logPath: join('/tmp/store', 'cliproxy.log'),
      leaseDir: join('/tmp/store', 'leases'),
      requestLeaseDir: join('/tmp/store', 'requests'),
      operationLockPath: join('/tmp/store', 'operation.lock'),
      pidPath: join('/tmp/store', 'server.pid'),
    })
  })

  it('builds a config the server can parse with localhost-only management', () => {
    const yaml = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: '/tmp/store/auth',
    })
    expect(parse(yaml)).toEqual({
      'host': '127.0.0.1',
      'port': 8317,
      'auth-dir': '/tmp/store/auth',
      'api-keys': ['proxy-key'],
      'debug': false,
      'logging-to-file': false,
      'request-log': false,
      'request-retry': 3,
      'max-retry-interval': 30,
      'transient-error-cooldown-seconds': -1,
      'routing': {
        'strategy': 'round-robin',
        'session-affinity': true,
      },
      'remote-management': {
        'allow-remote': false,
        'secret-key': 'mgmt-key',
      },
    })
  })

  it('includes a proxy URL from extra config', () => {
    const yaml = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: '/tmp/store/auth',
      extraConfig: 'proxy-url: http://127.0.0.1:7890',
    })

    const config = parse(yaml) as Record<string, unknown>
    expect(config['proxy-url']).toBe('http://127.0.0.1:7890')
  })

  it('applies session defaults to restored providers before extra config overrides', () => {
    const providers = [
      { 'name': 'zen', 'base-url': 'https://opencode.ai/zen/v1' },
      { 'name': 'router', 'base-url': 'https://openrouter.ai/api/v1', 'headers': { 'X-Session-ID': '' } },
    ]
    const options = {
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: '/tmp/store/auth',
      openAICompatibility: providers,
    }
    expect(parse(buildManagedConfig(options))).toMatchObject({
      'openai-compatibility': [
        { ...providers[0], headers: { 'x-opencode-session': '$CPA-SESSION-ID' } },
        providers[1],
      ],
    })
    expect(providers[0]).not.toHaveProperty('headers')
    const extraConfig = 'openai-compatibility:\n  - name: manual\n    base-url: https://opencode.ai/zen/v1\n    headers:\n      x-opencode-session: custom-session'
    const config = parse(buildManagedConfig({ ...options, extraConfig })) as Record<string, unknown>
    const extra = parse(extraConfig) as Record<string, unknown>
    expect(config['openai-compatibility']).toEqual(extra['openai-compatibility'])
  })

  it('deep merges extra YAML with unrestricted overrides and array replacement', () => {
    const config = parse(buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: '/tmp/store/auth',
      extraConfig: 'port: 9000\nrouting:\n  strategy: fill-first\napi-keys: [custom-key]\nremote-management:\n  secret-key: custom-secret\nrequest-retry: 0\nproxy-url: null\ncustom: true',
    })) as Record<string, unknown>
    expect(config).toMatchObject({
      'port': 9000,
      'routing': { 'strategy': 'fill-first', 'session-affinity': true },
      'api-keys': ['custom-key'],
      'remote-management': { 'allow-remote': false, 'secret-key': 'custom-secret' },
      'request-retry': 0,
      'proxy-url': null,
      'custom': true,
    })
  })

  it.each(['', '  ', '# proxy-url: http://127.0.0.1:7890\n# request-retry: 3'])(
    'treats empty or commented extra config as no overrides: %s',
    source => expect(parseExtraConfig(source)).toEqual({}),
  )

  it.each(['[invalid', '- item', 'null', 'true'])(
    'rejects invalid extra config: %s',
    source => expect(() => parseExtraConfig(source)).toThrow('server.extraConfig'),
  )

  it('generates unique random 32-byte hex secrets', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})
