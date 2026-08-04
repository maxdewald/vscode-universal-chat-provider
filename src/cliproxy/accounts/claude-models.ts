import type { ManagementClient } from '@src/cliproxy/api/management-client'
import { Type } from '@sinclair/typebox'
import { asJsonValue, asValue } from '@src/shared/json'

const MODELS_URL = 'https://api.anthropic.com/v1/models'

const ModelsPayloadSchema = Type.Object({
  data: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
  }, { additionalProperties: true }))),
}, { additionalProperties: true })

export async function discoverAuthorizedClaudeModels(client: ManagementClient): Promise<Set<string> | undefined> {
  const accounts = (await client.listAuthFilesRaw()).filter(isClaudeAccount)
  if (accounts.length === 0)
    return undefined

  const results = await Promise.all(accounts.map(async (account) => {
    const authIndex = account.auth_index?.trim()
    if (authIndex === undefined || authIndex === '')
      return undefined
    try {
      const response = await client.apiCall({
        auth_index: authIndex,
        method: 'GET',
        url: MODELS_URL,
        header: {
          'Authorization': 'Bearer $TOKEN$',
          'Accept': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      })
      if (response.statusCode < 200 || response.statusCode >= 300)
        return undefined
      const payload = asValue(ModelsPayloadSchema, response.body) ?? asJsonValue(ModelsPayloadSchema, response.body)
      return payload === undefined ? undefined : payload.data?.map(model => model.id) ?? []
    }
    catch {
      return undefined
    }
  }))

  const successful = results.filter((ids): ids is string[] => ids !== undefined)
  if (successful.length === 0)
    return undefined
  return new Set(successful.flat())
}

function isClaudeAccount(account: { type?: string, provider?: string }): boolean {
  return account.type?.toLowerCase() === 'claude' || account.provider?.toLowerCase() === 'claude'
}