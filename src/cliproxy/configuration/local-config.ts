import { readFile } from 'node:fs/promises'
import { Type } from '@sinclair/typebox'
import { parseDocument } from 'yaml'
import { asValue } from '../../shared/json'

const PLACEHOLDER_KEY = /^your-api-key(?:-\d+)?$/i

export interface LocalProxyConfig {
  path: string
  apiKey?: string
  managementKey?: string
}

const LocalConfigSchema = Type.Object({
  'api-keys': Type.Optional(Type.Array(Type.Unknown())),
  'remote-management': Type.Optional(Type.Object({
    'secret-key': Type.Optional(Type.String()),
  })),
})

export async function readLocalProxyConfig(configPath: string): Promise<LocalProxyConfig> {
  const yamlDocument = parseDocument(await readFile(configPath, 'utf8'), {
    prettyErrors: true,
    strict: true,
    stringKeys: true,
  })
  if (yamlDocument.errors.length > 0)
    throw yamlDocument.errors[0]
  const document: unknown = yamlDocument.toJSON() as unknown
  const apiKey = firstApiKey(document)
  const managementKey = managementSecretKey(document)
  return {
    path: configPath,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(managementKey === undefined ? {} : { managementKey }),
  }
}

function managementSecretKey(value: unknown): string | undefined {
  const key = asValue(LocalConfigSchema, value)?.['remote-management']?.['secret-key']
  if (key === undefined || key.trim().length === 0 || key.startsWith('$2'))
    return undefined
  return key.trim()
}

function firstApiKey(value: unknown): string | undefined {
  const keys = asValue(LocalConfigSchema, value)?.['api-keys']
  if (keys === undefined)
    return undefined
  for (const candidate of keys) {
    if (typeof candidate !== 'string')
      continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0 && !PLACEHOLDER_KEY.test(trimmed))
      return trimmed
  }
  return undefined
}
