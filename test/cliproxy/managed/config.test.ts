import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildManagedConfig, generateSecret, managedPaths, setConfigPort, setProxyUrl } from '../../../src/cliproxy/managed/config'

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
      'logging-to-file': false,
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

  it('generates unique random 32-byte hex secrets', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('setConfigPort', () => {
  let dir: string

  afterEach(async () => {
    if (dir !== undefined)
      await rm(dir, { recursive: true, force: true })
  })

  it('rewrites only the port and preserves the keys', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ucp-config-'))
    const configPath = join(dir, 'config.yaml')
    await writeFile(configPath, buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: join(dir, 'auth'),
    }))

    await setConfigPort(configPath, 51227)

    expect(parse(await readFile(configPath, 'utf8'))).toEqual({
      'host': '127.0.0.1',
      'port': 51227,
      'auth-dir': join(dir, 'auth'),
      'api-keys': ['proxy-key'],
      'logging-to-file': false,
      'remote-management': {
        'allow-remote': false,
        'secret-key': 'mgmt-key',
      },
    })
  })
})

describe('setProxyUrl', () => {
  let dir: string

  afterEach(async () => {
    if (dir !== undefined)
      await rm(dir, { recursive: true, force: true })
  })

  it('sets and clears the proxy URL without changing other config', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ucp-config-'))
    const configPath = join(dir, 'config.yaml')
    await writeFile(configPath, buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'proxy-key',
      managementKey: 'mgmt-key',
      authDir: join(dir, 'auth'),
    }))

    await setProxyUrl(configPath, ' http://127.0.0.1:7890 ')
    expect(parse(await readFile(configPath, 'utf8'))).toMatchObject({
      'port': 8317,
      'proxy-url': 'http://127.0.0.1:7890',
    })

    await setProxyUrl(configPath, '')
    expect(parse(await readFile(configPath, 'utf8'))).toMatchObject({ port: 8317 })
    expect(parse(await readFile(configPath, 'utf8'))).not.toHaveProperty('proxy-url')
  })
})
