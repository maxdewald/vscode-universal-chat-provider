import type { OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { stringify } from 'yaml'

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
  openAICompatibility?: OpenAICompatibilityProvider[]
  proxyUrl?: string
}

export function buildManagedConfig(options: ManagedConfigOptions): string {
  const config: Record<string, unknown> = {
    'host': options.host,
    'port': options.port,
    'auth-dir': options.authDir,
    'api-keys': [options.apiKey],
    'logging-to-file': false,
    'routing': {
      'strategy': 'round-robin',
      'session-affinity': true,
    },
    'remote-management': {
      'allow-remote': false,
      'secret-key': options.managementKey,
    },
  }
  const proxyUrl = options.proxyUrl?.trim()
  if (proxyUrl !== undefined && proxyUrl.length > 0)
    config['proxy-url'] = proxyUrl
  if (options.openAICompatibility !== undefined && options.openAICompatibility.length > 0)
    config['openai-compatibility'] = options.openAICompatibility
  return stringify(config)
}
