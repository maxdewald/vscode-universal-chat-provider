import { UniversalChatProvider } from '@src/chat/provider'
import { ServerController } from '@src/cliproxy/controller'
import { createFastModeNudge } from '@src/extension/fast-mode-nudge'
import { activate, deactivate } from '@src/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderModel } from '../support/chat'
import {
  createExtensionContext,
  outputChannelByName,
  resetVSCodeMock,
  statusBarItemByPriority,
  vscodeMock,
} from '../support/vscode'

const suggest = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../../src/extension/fast-mode-nudge', () => ({ createFastModeNudge: vi.fn(() => suggest) }))

beforeEach(() => {
  resetVSCodeMock()
  deactivate()
})

describe('extension activation', () => {
  it('wires the provider, controller, status bar, outputs, and commands', async () => {
    const initialize = vi.spyOn(UniversalChatProvider.prototype, 'initialize').mockResolvedValue()
    const refreshQuotas = vi.spyOn(ServerController.prototype, 'refreshQuotas').mockResolvedValue()
    const setRefreshListener = vi.spyOn(ServerController.prototype, 'setRefreshListener')
    const setStatusListener = vi.spyOn(ServerController.prototype, 'setStatusListener')
    const setQuotaListener = vi.spyOn(ServerController.prototype, 'setQuotaListener')
    const context = createExtensionContext({ globalStoragePath: '/tmp/ucp-index-test' })

    expect(activate(context)).toBeUndefined()
    expect(vscodeMock.registeredProviders[0]).toMatchObject({ vendor: 'universal-chat-provider' })
    expect(initialize).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(refreshQuotas).toHaveBeenCalledTimes(1))
    expect(setRefreshListener).toHaveBeenCalledTimes(1)
    expect(setStatusListener).toHaveBeenCalledTimes(1)
    expect(setQuotaListener).toHaveBeenCalledTimes(1)

    const output = outputChannelByName('Universal Chat Provider')
    const serverOutput = outputChannelByName('CLIProxyAPI Server')
    expect(output).toBeDefined()
    expect(serverOutput).toBeDefined()
    expect(output).not.toBe(serverOutput)

    const statusBar = statusBarItemByPriority(100)
    expect(statusBar?.command).toBe('universalChatProvider.manage')
    expect(statusBar?.show).toHaveBeenCalledTimes(1)
    expect(context.subscriptions).toEqual(expect.arrayContaining([output, serverOutput, statusBar]))

    const provider = vscodeMock.registeredProviders[0]!.provider as UniversalChatProvider
    const standard = createProviderModel()
    const fast = createProviderModel({ id: `${standard.id}:fast`, serviceTier: 'priority' })
    vi.spyOn(provider, 'fastModel').mockReturnValue(fast)
    const quotaListener = setQuotaListener.mock.calls[0]![0]
    expect(createFastModeNudge).toHaveBeenCalledWith(context, expect.any(ServerController))
    quotaListener([])
    expect(suggest).not.toHaveBeenCalled()
    provider.onActivity?.(standard, false)
    quotaListener([])
    expect(suggest).not.toHaveBeenCalled()
    provider.onActivity?.(standard, true)
    quotaListener([])
    expect(suggest).toHaveBeenCalledWith(standard, fast, [])
  })
})
