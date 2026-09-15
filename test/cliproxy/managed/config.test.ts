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

  it('includes a configured proxy URL', () => {
    const yaml = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: '/tmp/store/auth',
      proxyUrl: ' http://127.0.0.1:7890 ',
    })

    const config = parse(yaml) as Record<string, unknown>
    expect(config['proxy-url']).toBe('http://127.0.0.1:7890')
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

  it.each(['[invalid', '- item'])(
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
