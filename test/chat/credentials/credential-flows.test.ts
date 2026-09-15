import { CredentialFlows } from '@src/chat/credentials/credential-flows'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetVSCodeMock, vscodeMock, window } from '../../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

describe('credential flows', () => {
  it('configures a connection, prompts for a missing key, and refreshes', async () => {
    const { flow, credentials, registry } = createFlow()
    window.showInputBox
      .mockResolvedValueOnce('http://new-proxy/')
    credentials.get.mockResolvedValueOnce(undefined)
    credentials.prompt.mockResolvedValueOnce('entered-key')

    await flow.configure()

    expect(vscodeMock.settings.get('universalChatProvider.baseUrl')).toBe('http://new-proxy')
    expect(credentials.prompt).toHaveBeenCalledTimes(1)
    expect(registry.forceRefresh).toHaveBeenCalledWith(true)
  })

  it('does nothing when connection configuration is cancelled', async () => {
    const { flow, registry } = createFlow()
    window.showInputBox.mockResolvedValueOnce(undefined)

    await flow.configure()

    expect(registry.forceRefresh).not.toHaveBeenCalled()
  })

  it('configures the connection during onboarding', async () => {
    const { flow, credentials, registry } = createFlow()
    window.showInformationMessage.mockResolvedValueOnce('Configure Connection')
    window.showInputBox.mockResolvedValueOnce('http://proxy')
    credentials.get.mockResolvedValueOnce(undefined)

    await flow.showOnboarding()

    expect(credentials.prompt).toHaveBeenCalledTimes(1)
    expect(registry.forceRefresh).toHaveBeenCalledWith(true)
  })

  it('clears credentials, resets models, and re-shows onboarding', async () => {
    const { flow, credentials, registry } = createFlow()

    await flow.clearCredentials()

    expect(credentials.clear).toHaveBeenCalledTimes(1)
    expect(registry.reset).toHaveBeenCalledTimes(1)
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'CLIProxyAPI setup is incomplete. Configure a connection to load local models.',
      'Configure Connection',
    )
  })

  it('accepts a manually entered replacement key and refreshes', async () => {
    const { flow, credentials, registry } = createFlow()
    window.showWarningMessage.mockResolvedValueOnce('Enter API Key')

    await flow.showCredentialRecovery()

    expect(credentials.prompt).toHaveBeenCalledTimes(1)
    expect(registry.forceRefresh).toHaveBeenCalledWith(false)
  })

  it('does not refresh when replacement key entry is cancelled', async () => {
    const { flow, credentials, registry } = createFlow()
    window.showWarningMessage.mockResolvedValueOnce('Enter API Key')
    credentials.prompt.mockResolvedValueOnce(undefined)

    await flow.showCredentialRecovery()

    expect(registry.forceRefresh).not.toHaveBeenCalled()
  })

  it('shows credential recovery once until credentials are accepted', async () => {
    const { flow } = createFlow()
    window.showWarningMessage.mockResolvedValue(undefined)

    await flow.showCredentialRecovery()
    await flow.showCredentialRecovery()
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1)

    flow.markCredentialsAccepted()
    await flow.showCredentialRecovery()
    expect(window.showWarningMessage).toHaveBeenCalledTimes(2)
  })
})

function createFlow() {
  const credentials = {
    get: vi.fn<() => Promise<string | undefined>>(async () => 'key'),
    prompt: vi.fn<() => Promise<string | undefined>>(async () => 'key'),
    clear: vi.fn(async () => {}),
  }
  const registry = {
    forceRefresh: vi.fn(async () => []),
    reset: vi.fn(),
  }
  return {
    credentials,
    registry,
    flow: new CredentialFlows(credentials as never, registry as never),
  }
}
