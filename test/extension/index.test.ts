import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UniversalChatProvider } from '../../src/chat/provider'
import { ServerController } from '../../src/cliproxy/controller'
import { activate, deactivate } from '../../src/index'
import {
  createExtensionContext,
  outputChannelByName,
  resetVSCodeMock,
  statusBarItemByPriority,
  vscodeMock,
} from '../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
  deactivate()
})

describe('extension activation', () => {
  it('wires the provider, controller, status bar, outputs, and commands', () => {
    const initialize = vi.spyOn(UniversalChatProvider.prototype, 'initialize').mockResolvedValue()
    const setRefreshListener = vi.spyOn(ServerController.prototype, 'setRefreshListener')
    const setStatusListener = vi.spyOn(ServerController.prototype, 'setStatusListener')
    const setQuotaListener = vi.spyOn(ServerController.prototype, 'setQuotaListener')
    const context = createExtensionContext({ globalStoragePath: '/tmp/ucp-index-test' })

    expect(activate(context)).toBeUndefined()
    expect(vscodeMock.registeredProviders[0]).toMatchObject({ vendor: 'universal-chat-provider' })
    expect(vscodeMock.commandHandlers).toHaveLength(15)
    expect(initialize).toHaveBeenCalledTimes(1)
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
  })
})
