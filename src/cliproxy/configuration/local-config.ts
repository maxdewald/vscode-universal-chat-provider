import { readFile } from 'node:fs/promises'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'
import { parseDocument } from 'yaml'

const PLACEHOLDER_KEY = /^your-api-key(?:-\d+)?$/i

export interface LocalProxyConfig {
  path: string
  apiKey?: string
}

const LocalConfigSchema = Type.Object({
  'api-keys': Type.Optional(Type.Array(Type.Unknown())),
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
  return {
    path: configPath,
    ...(apiKey === undefined ? {} : { apiKey }),
  }
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
