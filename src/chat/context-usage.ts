import { LanguageModelDataPart } from 'vscode'
import { normalizeUsage } from './cache-metrics'

const USAGE_MIME = 'usage'

export function createContextUsagePart(usage: unknown): LanguageModelDataPart | undefined {
  const { inputTokens, outputTokens, cacheReadTokens } = normalizeUsage(usage)
  if (inputTokens <= 0 && outputTokens <= 0)
    return undefined
  return LanguageModelDataPart.json({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    prompt_tokens_details: { cached_tokens: cacheReadTokens },
  }, USAGE_MIME)
}
