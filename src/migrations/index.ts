import type { Memento } from 'vscode'
import { providerPrefixedModelIds } from '@src/migrations/provider-prefixed-model-ids'
import { errorMessage } from '@src/shared/errors'

export interface MigrationContext {
  proxyModelIds: readonly string[]
}

export interface Migration {
  id: string
  // Resolves true once finished; false retries on the next model refresh.
  run: (context: MigrationContext) => Promise<boolean>
}

const DONE_KEY = 'universalChatProvider.migrationsDone'

export const MIGRATIONS: readonly Migration[] = [
  providerPrefixedModelIds,
]

export async function runMigrations(
  state: Memento,
  context: MigrationContext,
  log: (message: string) => void,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const done = new Set(state.get<string[]>(DONE_KEY, []))
  const pending = migrations.filter(migration => !done.has(migration.id))
  if (pending.length === 0)
    return
  for (const migration of pending) {
    const finished = await migration.run(context).catch((error: unknown) => {
      log(`Migration ${migration.id} failed: ${errorMessage(error)}`)
      return false
    })
    if (finished)
      done.add(migration.id)
  }
  await state.update(DONE_KEY, [...done])
}
