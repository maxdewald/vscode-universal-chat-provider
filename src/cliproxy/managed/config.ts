import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPlainObject } from 'moderndash'
import { parse, stringify } from 'yaml'

export const DEFAULT_PORT = 8317
export const DEFAULT_HOST = '127.0.0.1'

export interface ManagedPaths {
  root: string
  binDir: string
  authDir: string
  configPath: string
  logPath: string
  leaseDir: string
  operationLockPath: string
  pidPath: string
}

export function managedPaths(root: string): ManagedPaths {
  return {
    root,
    binDir: join(root, 'bin'),
    authDir: join(root, 'auth'),
    configPath: join(root, 'config.yaml'),
    logPath: join(root, 'cliproxy.log'),
    leaseDir: join(root, 'leases'),
    operationLockPath: join(root, 'operation.lock'),
    pidPath: join(root, 'server.pid'),
  }
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex')
}

export interface ManagedConfigOptions {
  host: string
  port: number
  apiKey: string
  managementKey: string
  authDir: string
  proxyUrl?: string
}

export function buildManagedConfig(options: ManagedConfigOptions): string {
  const config: Record<string, unknown> = {
    'host': options.host,
    'port': options.port,
    'auth-dir': options.authDir,
    'api-keys': [options.apiKey],
    'logging-to-file': false,
    'remote-management': {
      'allow-remote': false,
      'secret-key': options.managementKey,
    },
  }
  const proxyUrl = options.proxyUrl?.trim()
  if (proxyUrl !== undefined && proxyUrl.length > 0)
    config['proxy-url'] = proxyUrl
  return stringify(config)
}

export async function setConfigPort(configPath: string, port: number): Promise<void> {
  const parsed: unknown = parse(await readFile(configPath, 'utf8'))
  const config = isPlainObject(parsed) ? parsed : {}
  if (config.port === port)
    return
  config.port = port
  await writeFile(configPath, stringify(config))
}

export async function setProxyUrl(configPath: string, proxyUrl: string | undefined): Promise<void> {
  const parsed: unknown = parse(await readFile(configPath, 'utf8'))
  const config = isPlainObject(parsed) ? parsed : {}
  const trimmed = proxyUrl?.trim()
  if (trimmed === undefined || trimmed.length === 0) {
    if (!('proxy-url' in config))
      return
    delete config['proxy-url']
    await writeFile(configPath, stringify(config))
    return
  }
  if (config['proxy-url'] === trimmed)
    return
  config['proxy-url'] = trimmed
  await writeFile(configPath, stringify(config))
}
