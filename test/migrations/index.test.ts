import type { Migration } from '@src/migrations/index'
import { runMigrations } from '@src/migrations/index'
import { describe, expect, it, vi } from 'vitest'
import { createExtensionContext } from '../support/vscode'

const context = { proxyModelIds: ['claude/claude-opus-5'] }

describe('runMigrations', () => {
  it('runs pending migrations in order once, retrying any that are not finished yet', async () => {
    const { globalState } = createExtensionContext()
    const order: string[] = []
    let ready = false
    const migrations: Migration[] = [
      { id: 'first', run: vi.fn(async () => {
        order.push('first')
        return true
      }) },
      { id: 'second', run: vi.fn(async () => {
        order.push('second')
        return ready
      }) },
    ]

    await runMigrations(globalState, context, vi.fn(), migrations)
    ready = true
    await runMigrations(globalState, context, vi.fn(), migrations)
    await runMigrations(globalState, context, vi.fn(), migrations)

    expect(order).toEqual(['first', 'second', 'second'])
    expect(migrations[1]!.run).toHaveBeenCalledWith(context)
  })

  it('logs a failed migration, keeps running the rest and retries it later', async () => {
    const { globalState } = createExtensionContext()
    const log = vi.fn()
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    const next = vi.fn(async () => true)
    const migrations: Migration[] = [{ id: 'failing', run: failing }, { id: 'next', run: next }]

    await runMigrations(globalState, context, log, migrations)
    await runMigrations(globalState, context, log, migrations)

    expect(log).toHaveBeenCalledWith('Migration failing failed: boom')
    expect(failing).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
