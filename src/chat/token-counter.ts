import type { CancellationToken, LanguageModelChatRequestMessage, OutputChannel } from 'vscode'
import type { ProxyConnection } from '../cliproxy/connection'
import type { CredentialStore } from '../cliproxy/credentials'
import type { ProviderModel } from './model'
import { createHash } from 'node:crypto'
import { CLIProxyClient } from '../cliproxy/client'
import { errorMessage } from '../shared/errors'
import { buildCountPayload, fingerprintCountValue } from './request'

/** Most-recent counts to keep resident; token counts of fixed content never change. */
const MAX_CACHE_ENTRIES = 4096
/** Cap concurrent count requests so prompt building can't flood the proxy. */
const MAX_CONCURRENCY = 8
/** Give up on a single count so a slow proxy can never stall prompt building. */
const REQUEST_TIMEOUT_MS = 15_000

export interface TokenCounterDeps {
  connection: ProxyConnection
  credentials: CredentialStore
  output: OutputChannel
}

/**
 * Counts tokens exactly via the proxy's `count_tokens` endpoint — no local
 * estimation. Results are cached by content (so stable history is counted at
 * most once) and identical in-flight requests are coalesced. A count that
 * cannot be obtained (no credentials, transport failure, timeout, cancellation)
 * returns 0 rather than a guessed number: an unknown contributes nothing to the
 * budget, deferring compression to the real limit instead of triggering it early.
 */
export class TokenCounter {
  private readonly cache = new Map<string, number>()
  private readonly inFlight = new Map<string, Promise<number>>()
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly deps: TokenCounterDeps) {}

  async count(
    model: ProviderModel,
    value: string | LanguageModelChatRequestMessage,
    token?: CancellationToken,
  ): Promise<number> {
    if (token?.isCancellationRequested)
      return 0

    const key = this.cacheKey(model, value)
    const cached = this.cache.get(key)
    if (cached !== undefined)
      return cached

    const existing = this.inFlight.get(key)
    if (existing !== undefined)
      return existing

    const request = this.fetchCount(model, value, token)
      .then((count) => {
        if (count !== undefined)
          this.remember(key, count)
        return count ?? 0
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }

  private async fetchCount(
    model: ProviderModel,
    value: string | LanguageModelChatRequestMessage,
    token?: CancellationToken,
  ): Promise<number | undefined> {
    return this.withSlot(async () => {
      if (token?.isCancellationRequested)
        return undefined

      let apiKey: string | undefined
      try {
        await this.deps.connection.ensureReady(false)
        apiKey = await this.deps.credentials.get()
      }
      catch {
        return undefined
      }
      if (apiKey === undefined)
        return undefined

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const cancellation = token?.onCancellationRequested(() => controller.abort())
      try {
        const client = new CLIProxyClient(this.deps.connection.baseUrl(), apiKey)
        return await client.countInputTokens(buildCountPayload(model, value), controller.signal)
      }
      catch (error) {
        if (token?.isCancellationRequested !== true)
          this.deps.output.appendLine(`[token-count] ${model.proxyModelId}: ${errorMessage(error)}`)
        return undefined
      }
      finally {
        clearTimeout(timeout)
        cancellation?.dispose()
      }
    })
  }

  private remember(key: string, count: number): void {
    this.cache.set(key, count)
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined)
        this.cache.delete(oldest)
    }
  }

  private cacheKey(model: ProviderModel, value: string | LanguageModelChatRequestMessage): string {
    return createHash('sha256')
      .update(model.proxyModelId)
      .update('\0')
      .update(fingerprintCountValue(value))
      .digest('hex')
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENCY)
      await new Promise<void>(resolve => this.waiters.push(resolve))
    this.active++
    try {
      return await task()
    }
    finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}
