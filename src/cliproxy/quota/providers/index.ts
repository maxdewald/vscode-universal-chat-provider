import type { QuotaProvider, QuotaReport } from '@src/cliproxy/quota/providers/types'
import { antigravityProvider } from '@src/cliproxy/quota/providers/antigravity'
import { claudeProvider } from '@src/cliproxy/quota/providers/claude'
import { codexProvider } from '@src/cliproxy/quota/providers/codex'
import { grokProvider } from '@src/cliproxy/quota/providers/grok'
import { kimiProvider } from '@src/cliproxy/quota/providers/kimi'

export const QUOTA_PROVIDERS = {
  codex: codexProvider,
  antigravity: antigravityProvider,
  claude: claudeProvider,
  grok: grokProvider,
  kimi: kimiProvider,
} satisfies Record<QuotaReport['provider'], QuotaProvider>

export function isQuotaProvider(value: string): value is QuotaReport['provider'] {
  return Object.hasOwn(QUOTA_PROVIDERS, value)
}
