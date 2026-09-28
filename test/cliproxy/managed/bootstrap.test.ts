import { readFile } from 'node:fs/promises'
import { provisionManagedState, watchCredentialFiles } from '@src/cliproxy/managed/bootstrap'
import { managedPaths } from '@src/cliproxy/managed/config'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { useTempDirectories } from '../../support/temp'
import { createExtensionContext, vscodeMock, workspace } from '../../support/vscode'

const makeTempDirectory = useTempDirectories()

describe('managed bootstrap', () => {
  it('watches only top-level credential files', () => {
    const disposables = watchCredentialFiles('/tmp/auth', vi.fn())
    const pattern = workspace.createFileSystemWatcher.mock.calls[0]?.[0] as { pattern?: string } | undefined

    expect(pattern?.pattern).toBe('*.json')
    expect(disposables).toHaveLength(4)
  })

  it('writes current secrets when managed config is recreated', async () => {
    const root = await makeTempDirectory('ucp-bootstrap-')
    const secrets = new Map([
      ['universalChatProvider.apiKey', 'old-api-key'],
      ['universalChatProvider.managementKey', 'old-management-key'],
    ])
    const state = await provisionManagedState({
      context: createExtensionContext({ globalStoragePath: root, secrets }),
      output: vscodeMock.output as never,
      requestedVersion: () => '8.0.3',
      inspectServer: async () => false,
      onUnexpectedExit: vi.fn(),
    })
    secrets.set('universalChatProvider.apiKey', 'new-api-key')
    secrets.set('universalChatProvider.managementKey', 'new-management-key')
    vscodeMock.settings.set('universalChatProvider.server.extraConfig', 'requests:\n  proxy-url: http://127.0.0.1:7890\nrouting:\n  strategy: fill-first\n  retry:\n    request-retry: 7')

    const writeConfig = (state.server as unknown as { deps: { writeConfig: (port: number) => Promise<void> } }).deps.writeConfig
    await writeConfig(8317)

    const config = parse(await readFile(managedPaths(root).configPath, 'utf8')) as Record<string, unknown>
    expect(config).toMatchObject({
      access: { 'api-keys': ['new-api-key'] },
      management: { 'secret-key': 'new-management-key' },
      routing: { 'strategy': 'fill-first', 'session-affinity': true, 'retry': { 'request-retry': 7 } },
      requests: { 'proxy-url': 'http://127.0.0.1:7890' },
    })
  })
})
