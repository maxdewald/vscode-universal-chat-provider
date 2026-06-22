import { readFile } from 'node:fs/promises'
import { isPlainObject } from 'moderndash'
import { parse } from 'yaml'

const PLACEHOLDER_KEY = /^your-api-key(?:-\d+)?$/i

export interface LocalProxyConfig {
  path: string
  apiKey?: string
  managementKey?: string
}

export async function readLocalProxyConfig(configPath: string): Promise<LocalProxyConfig> {
  const document = parse(await readFile(configPath, 'utf8'), {
    prettyErrors: true,
    strict: true,
    stringKeys: true,
  }) as unknown
  const apiKey = firstApiKey(document)
  const managementKey = managementSecretKey(document)
  return {
    path: configPath,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(managementKey === undefined ? {} : { managementKey }),
  }
}

function managementSecretKey(value: unknown): string | undefined {
  if (!isPlainObject(value) || !isPlainObject(value['remote-management']))
    return undefined
  const key = value['remote-management']['secret-key']
  if (typeof key !== 'string' || key.trim().length === 0 || key.startsWith('$2'))
    return undefined
  return key.trim()
}

function firstApiKey(value: unknown): string | undefined {
  if (!isPlainObject(value) || !Array.isArray(value['api-keys']))
    return undefined
  return value['api-keys'].find((candidate): candidate is string =>
    typeof candidate === 'string'
    && candidate.trim().length > 0
    && !PLACEHOLDER_KEY.test(candidate.trim()),
  )?.trim()
}
