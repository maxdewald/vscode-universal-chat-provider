import { providerPrefixedModelIds } from '@src/migrations/provider-prefixed-model-ids'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetVSCodeMock, vscodeMock } from '../support/vscode'

const proxyModelIds = ['claude/claude-sonnet-4-6', 'antigravity/claude-sonnet-4-6', 'claude/claude-opus-5', 'antigravity/gemini-3-flash']

describe('providerPrefixedModelIds', () => {
  beforeEach(() => resetVSCodeMock())

  it('moves saved bare ids to their only provider-prefixed model, keeping suffixes', async () => {
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/claude-opus-5:utility-low')
    vscodeMock.settings.set('chat.utilitySmallModel', 'universal-chat-provider/claude-opus-5')
    vscodeMock.settings.set('universalChatProvider.dictation.engine', 'gemini-3-flash')

    expect(await providerPrefixedModelIds.run({ proxyModelIds })).toBe(true)

    expect(vscodeMock.settings.get('chat.utilityModel')).toBe('universal-chat-provider/claude/claude-opus-5:utility-low')
    expect(vscodeMock.settings.get('chat.utilitySmallModel')).toBe('universal-chat-provider/claude/claude-opus-5')
    expect(vscodeMock.settings.get('universalChatProvider.dictation.engine')).toBe('antigravity/gemini-3-flash')
  })

  it('migrates a model whose Fast variant repeats its proxy id', async () => {
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/gpt-6-luna:fast:utility-low')

    await providerPrefixedModelIds.run({ proxyModelIds: ['codex/gpt-6-luna', 'codex/gpt-6-luna'] })

    expect(vscodeMock.settings.get('chat.utilityModel')).toBe('universal-chat-provider/codex/gpt-6-luna:fast:utility-low')
  })

  it('leaves ambiguous, foreign, already migrated and unknown values alone', async () => {
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/claude-sonnet-4-6')
    vscodeMock.settings.set('chat.utilitySmallModel', 'copilot/gpt-5-mini')
    vscodeMock.settings.set('universalChatProvider.dictation.engine', 'gpt-transcribe')

    await providerPrefixedModelIds.run({ proxyModelIds })

    expect(vscodeMock.settings.get('chat.utilityModel')).toBe('universal-chat-provider/claude-sonnet-4-6')
    expect(vscodeMock.settings.get('chat.utilitySmallModel')).toBe('copilot/gpt-5-mini')
    expect(vscodeMock.settings.get('universalChatProvider.dictation.engine')).toBe('gpt-transcribe')

    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/claude/claude-opus-5')
    await providerPrefixedModelIds.run({ proxyModelIds })
    expect(vscodeMock.settings.get('chat.utilityModel')).toBe('universal-chat-provider/claude/claude-opus-5')
  })

  it('waits while any model is still served without a provider prefix', async () => {
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/claude-opus-5')

    expect(await providerPrefixedModelIds.run({ proxyModelIds: [...proxyModelIds, 'claude-opus-5'] })).toBe(false)
    expect(await providerPrefixedModelIds.run({ proxyModelIds: [] })).toBe(false)

    expect(vscodeMock.settings.get('chat.utilityModel')).toBe('universal-chat-provider/claude-opus-5')
  })
})
