import { describe, expect, it, vi } from 'vitest'
import { watchCredentialFiles } from '../../../src/cliproxy/managed/bootstrap'
import { workspace } from '../../support/vscode'

describe('managed bootstrap', () => {
  it('watches only top-level credential files', () => {
    const disposables = watchCredentialFiles('/tmp/auth', vi.fn())
    const pattern = workspace.createFileSystemWatcher.mock.calls[0]?.[0] as { pattern?: string } | undefined

    expect(pattern?.pattern).toBe('*.json')
    expect(disposables).toHaveLength(4)
  })
})
