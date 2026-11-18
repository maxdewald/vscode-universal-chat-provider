// Added 2026-11-18: models became `<provider>/<model>`. Delete after 2027-02-18.
import type { Migration } from '@src/migrations/index'
import { upstreamModelId } from '@src/chat/models/model'
import { ConfigurationTarget, workspace } from 'vscode'

const SETTINGS = [
  ['chat', 'utilityModel', 'universal-chat-provider/'],
  ['chat', 'utilitySmallModel', 'universal-chat-provider/'],
  ['universalChatProvider.dictation', 'engine', ''],
] as const

export const providerPrefixedModelIds: Migration = {
  id: 'provider-prefixed-model-ids',
  run: async ({ proxyModelIds }) => {
    // Waits until every account is pinned, so a bare id that is still served is never rewritten.
    if (proxyModelIds.length === 0 || !proxyModelIds.every(id => id.includes('/')))
      return false
    const byUpstream = Map.groupBy(proxyModelIds, upstreamModelId)
    for (const [section, key, prefix] of SETTINGS) {
      const settings = workspace.getConfiguration(section)
      const value = settings.get<string>(key, '').trim()
      if (value === '' || !value.startsWith(prefix))
        continue
      const id = value.slice(prefix.length)
      const suffixAt = id.includes(':') ? id.indexOf(':') : id.length
      const matches = byUpstream.get(id.slice(0, suffixAt))
      if (matches?.length === 1)
        await settings.update(key, `${prefix}${matches[0]}${id.slice(suffixAt)}`, ConfigurationTarget.Global)
    }
    return true
  },
}
