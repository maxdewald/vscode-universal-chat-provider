import type { QuotaProvider, QuotaWindow } from '@src/cliproxy/providers/types'
import { Type } from '@sinclair/typebox'
import { upstreamModelId } from '@src/chat/models/model'
import { clamp, minRemaining, parseReset } from '@src/cliproxy/providers/types'
import { asValue } from '@src/shared/json'

const BodySchema = Type.Object({
  groups: Type.Optional(Type.Array(Type.Object({
    displayName: Type.Optional(Type.String()),
    buckets: Type.Optional(Type.Array(Type.Object({
      window: Type.Optional(Type.String()),
      remainingFraction: Type.Number(),
      resetTime: Type.Optional(Type.String()),
    }))),
  }))),
})

const FILLER_WORDS = new Set(['and', 'models', 'model'])

// Quota comes from `agy /usage`, which the plugin reports per account through the host.
export const antigravityProvider: QuotaProvider = {
  source: 'the cliproxy-antigravity plugin',
  load: async (client, authIndex, signal) => client.pluginQuota('cliproxy-antigravity', authIndex, signal),
  apply: (report, data) => {
    report.windows = parseWindows(data)
  },
  owners: ['google-antigravity-cli'],
  // A group such as "Claude and GPT models" gates the models whose id starts with one of its names.
  remaining: (report, proxyModelId) => {
    const id = upstreamModelId(proxyModelId).toLowerCase()
    return minRemaining(report.windows.filter(window => window.key?.split(',').some(family => id.startsWith(family)) === true))
  },
}

function parseWindows(data: unknown): QuotaWindow[] {
  return (asValue(BodySchema, data)?.groups ?? []).flatMap((group) => {
    const name = group.displayName?.trim() ?? ''
    const families = name.toLowerCase().split(/\s+/).filter(word => word !== '' && !FILLER_WORDS.has(word))
    const title = name.replace(/\s+models?$/i, '')
    return (group.buckets ?? []).map((bucket) => {
      const resetsAt = parseReset(bucket.resetTime)
      return {
        key: families.join(','),
        label: `${title} ${bucket.window?.trim() ?? ''} Quota`,
        remainingPercent: clamp(bucket.remainingFraction * 100, 0, 100),
        ...(resetsAt === undefined ? {} : { resetsAt }),
      }
    })
  })
}
