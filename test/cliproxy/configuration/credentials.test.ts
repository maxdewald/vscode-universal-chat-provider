import {
  configureConnection,
  CredentialStore,
  normalizeBaseUrl,
} from '@src/cliproxy/configuration/credentials'
import { beforeEach, describe, expect, it } from 'vitest'
import { createExtensionContext, resetVSCodeMock, vscodeMock, window } from '../../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

describe('credentials', () => {
  it('normalizes URLs', () => {
    expect(normalizeBaseUrl(' https://proxy/// ')).toBe('https://proxy')
  })

  it('prompts, trims, stores, retrieves, and clears secrets', async () => {
    const context = createExtensionContext()
    const store = new CredentialStore(context)
    window.showInputBox.mockResolvedValueOnce('  entered-key  ')

    await expect(store.prompt()).resolves.toBe('entered-key')
    await expect(store.get()).resolves.toBe('entered-key')
    await store.clear()
    await expect(store.get()).resolves.toBeUndefined()

    window.showInputBox.mockResolvedValueOnce(undefined)
    await expect(store.prompt()).resolves.toBeUndefined()
  })

  it('configures only the URL, respecting cancellation', async () => {
    window.showInputBox
      .mockResolvedValueOnce(' http://proxy/// ')

    await expect(configureConnection()).resolves.toBe(true)
    expect(vscodeMock.settings.get('universalChatProvider.baseUrl')).toBe('http://proxy')
    expect(window.showInputBox).toHaveBeenCalledTimes(1)

    window.showInputBox.mockResolvedValueOnce(undefined)
    await expect(configureConnection()).resolves.toBe(false)

    const validation = window.showInputBox.mock.calls[0]?.[0]?.validateInput
    expect(validation?.('ftp://proxy')).toBe('Use an http:// or https:// URL.')
    expect(validation?.('not a url')).toBe('Enter a valid URL.')
    expect(validation?.('https://proxy')).toBeUndefined()
  })
})
