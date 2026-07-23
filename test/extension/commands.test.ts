import type { QuickPickItem } from 'vscode'
import type { UniversalChatProvider } from '../../src/chat/provider'
import type { ServerController, ServerStatusSnapshot } from '../../src/cliproxy/controller'
import type { QuotaSection } from '../../src/extension/ui/quota-menu'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCommands } from '../../src/extension/commands'
import { manageProvider } from '../../src/extension/ui/manage-menu'
import {
  commands,
  createOutputChannelMock,
  latestQuickPick,
  resetVSCodeMock,
  vscodeMock,
  window,
} from '../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

describe('registerCommands', () => {
  it('matches every command contributed by the extension manifest', () => {
    createCommandHarness()
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      contributes: { commands: Array<{ command: string }> }
    }

    expect([...vscodeMock.commandHandlers.keys()].sort()).toEqual(
      manifest.contributes.commands.map(entry => entry.command).sort(),
    )
  })

  it.each([
    ['login', (harness: CommandHarness) => harness.controller.login],
    ['manageAccounts', (harness: CommandHarness) => harness.controller.manageAccounts],
    ['configure', (harness: CommandHarness) => harness.provider.configure],
    ['importConfig', (harness: CommandHarness) => harness.provider.importConfig],
    ['restartServer', (harness: CommandHarness) => harness.controller.restartServer],
    ['updateBinary', (harness: CommandHarness) => harness.controller.updateBinary],
    ['resetServer', (harness: CommandHarness) => harness.controller.resetServer],
  ] as const)('forwards %s to its owner', async (command, getMethod) => {
    const harness = createCommandHarness()

    await commands.executeCommand(`universalChatProvider.${command}`)

    expect(getMethod(harness)).toHaveBeenCalledTimes(1)
  })

  it('refreshes models and reports the discovered count', async () => {
    const { provider } = createCommandHarness()
    provider.forceRefresh.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])

    await commands.executeCommand('universalChatProvider.refresh')

    expect(provider.forceRefresh).toHaveBeenCalledWith(true)
    expect(window.showInformationMessage).toHaveBeenCalledWith('CLIProxyAPI exposed 2 chat models.')
  })

  it('opens the quota picker with provider data and controller reset actions', async () => {
    const { provider, controller } = createCommandHarness()
    provider.quotaSections.mockReturnValueOnce([
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 75 }] },
    ])

    await commands.executeCommand('universalChatProvider.showQuota')

    expect(controller.refreshQuotas).toHaveBeenCalledTimes(1)
    expect(controller.listCodexResets).toHaveBeenCalledTimes(1)
    expect(latestQuickPick()?.items).toEqual([
      expect.objectContaining({ label: 'Codex · 5h Quota — 75% left' }),
    ])
  })

  it('delegates utility-model selection', async () => {
    const { provider } = createCommandHarness()

    await commands.executeCommand('universalChatProvider.setUtilityModel')

    expect(provider.getModels).toHaveBeenCalledWith(true)
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'No Universal Chat Provider models are available. Configure the provider and refresh its models first.',
    )
  })

  it('clears credentials only after confirmation', async () => {
    const { provider } = createCommandHarness()

    window.showWarningMessage.mockResolvedValueOnce(undefined)
    await commands.executeCommand('universalChatProvider.clearCredentials')
    expect(provider.clearCredentials).not.toHaveBeenCalled()

    window.showWarningMessage.mockResolvedValueOnce('Remove')
    await commands.executeCommand('universalChatProvider.clearCredentials')
    expect(provider.clearCredentials).toHaveBeenCalledTimes(1)
  })

  it('shows the extension and server output channels independently', async () => {
    const { output, serverOutput } = createCommandHarness()

    await commands.executeCommand('universalChatProvider.showLogs')
    await commands.executeCommand('universalChatProvider.showServerLogs')

    expect(output.show).toHaveBeenCalledWith(true)
    expect(serverOutput.show).toHaveBeenCalledWith(true)
  })

  it('opens settings scoped to this extension', async () => {
    createCommandHarness()

    await commands.executeCommand('universalChatProvider.openSettings')

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      '@ext:maxdewald.universal-chat-provider',
    )
  })
})

describe('manageProvider', () => {
  it.each([
    {
      mode: 'managed',
      snapshot: { mode: 'managed', status: 'running', baseUrl: 'http://127.0.0.1:8317' },
      present: ['$(debug-restart) Restart Server', '$(cloud-download) Update Proxy Binary'],
      absent: '$(settings-gear) Configure Connection',
    },
    {
      mode: 'external',
      snapshot: { mode: 'external', status: 'external', baseUrl: 'http://127.0.0.1:8317' },
      present: ['$(settings-gear) Configure Connection', '$(key) Import API Key from Config'],
      absent: '$(debug-restart) Restart Server',
    },
  ] as const)('shows $mode actions', async ({ mode, snapshot, present, absent }) => {
    window.showQuickPick.mockResolvedValueOnce(undefined)

    await manageProvider(menuController(mode, snapshot))

    const labels = quickPickLabels()
    expect(labels).toEqual(expect.arrayContaining([...present]))
    expect(labels).not.toContain(absent)
  })

  it.each([
    ['managed', { mode: 'managed', status: 'running', baseUrl: 'http://127.0.0.1:8317' }, 'universalChatProvider.showServerLogs'],
    ['external', { mode: 'external', status: 'external', baseUrl: 'http://127.0.0.1:8317' }, 'universalChatProvider.showLogs'],
  ] as const)('dispatches the %s status row', async (mode, snapshot, command) => {
    window.showQuickPick.mockImplementationOnce(async items => (items as QuickPickItem[])[0])

    await manageProvider(menuController(mode, snapshot))

    expect(commands.executeCommand).toHaveBeenCalledWith(command)
  })
})

function createCommandHarness() {
  const provider = {
    quotaSections: vi.fn((): QuotaSection[] => []),
    forceRefresh: vi.fn(async () => [] as Array<{ id: string }>),
    configure: vi.fn(async () => {}),
    importConfig: vi.fn(async () => {}),
    getModels: vi.fn(async () => []),
    getUtilityEffort: vi.fn(() => undefined),
    updateUtilityEffort: vi.fn(async () => {}),
    clearCredentials: vi.fn(async () => {}),
  }
  const controller = {
    mode: vi.fn(() => 'managed' as const),
    statusSnapshot: vi.fn(async () => ({ mode: 'managed', status: 'running', baseUrl: 'http://127.0.0.1:8317' } as const)),
    login: vi.fn(async () => {}),
    manageAccounts: vi.fn(async () => {}),
    refreshQuotas: vi.fn(async () => {}),
    listCodexResets: vi.fn(async () => []),
    claimCodexReset: vi.fn(async () => 'failed' as const),
    restartServer: vi.fn(async () => {}),
    updateBinary: vi.fn(async () => {}),
    resetServer: vi.fn(async () => {}),
  }
  const output = createOutputChannelMock('Universal Chat Provider')
  const serverOutput = createOutputChannelMock('CLIProxyAPI Server')
  registerCommands(
    provider as unknown as UniversalChatProvider,
    controller as unknown as ServerController,
    output as never,
    serverOutput as never,
  )
  return { provider, controller, output, serverOutput }
}

type CommandHarness = ReturnType<typeof createCommandHarness>

function menuController(mode: 'managed' | 'external', snapshot: ServerStatusSnapshot): ServerController {
  return {
    mode: () => mode,
    statusSnapshot: async () => snapshot,
  } as unknown as ServerController
}

function quickPickLabels(): string[] {
  return (window.showQuickPick.mock.calls[0]?.[0] as QuickPickItem[]).map(item => item.label)
}
