import type { QuotaProvider, QuotaReport } from '@src/cliproxy/providers/types'
import { antigravityProvider } from '@src/cliproxy/providers/antigravity/quota'
import { claudeProvider } from '@src/cliproxy/providers/claude/quota'
import { codexProvider } from '@src/cliproxy/providers/codex/quota'
import { grokProvider } from '@src/cliproxy/providers/grok/quota'
import { kimiProvider } from '@src/cliproxy/providers/kimi/quota'

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
