import type { CancellationToken, Uri } from 'vscode'
import { relative } from 'node:path'
import { extensions, window, workspace } from 'vscode'
import { errorMessage } from '../shared/errors'

const GIT_EXTENSION_ID = 'vscode.git'
const MAX_FILE_CONTEXT = 20_000
const MAX_TOTAL_CONTEXT = 100_000
const TOTAL_LIMIT_RESERVE = 128

export interface GitChange {
  readonly uri: Uri
}

export interface GitRepository {
  readonly rootUri: Uri
  readonly inputBox: { value: string }
  readonly state: {
    readonly HEAD: { readonly name?: string } | undefined
    readonly mergeChanges: readonly GitChange[]
    readonly indexChanges: readonly GitChange[]
    readonly workingTreeChanges: readonly GitChange[]
    readonly untrackedChanges: readonly GitChange[]
  }
  status: () => Promise<void>
  diffIndexWithHEAD: (path: string) => Promise<string>
  diffWithHEAD: (path: string) => Promise<string>
}

interface GitAPI {
  readonly repositories: readonly GitRepository[]
  getRepository: (uri: Uri) => GitRepository | null
  openRepository: (uri: Uri) => Promise<GitRepository | null>
}

interface GitExtension {
  readonly enabled: boolean
  getAPI: (version: 1) => GitAPI
}

/**
 * Find the repository to describe: the one named by `rootUri`, else the
 * UI-selected repository, else the only open one. Surfaces a message and
 * returns undefined when none can be resolved.
 */
export async function resolveRepository(rootUri?: Uri): Promise<GitRepository | undefined> {
  const extension = extensions.getExtension<GitExtension>(GIT_EXTENSION_ID)
  if (extension === undefined) {
    void window.showErrorMessage('The built-in Git extension is not available.')
    return undefined
  }

  const gitExtension = extension.isActive
    ? extension.exports
    : await extension.activate()
  if (!gitExtension.enabled) {
    void window.showErrorMessage('The built-in Git extension is disabled.')
    return undefined
  }

  const api = gitExtension.getAPI(1)
  if (rootUri !== undefined) {
    return api.getRepository(rootUri)
      ?? await api.openRepository(rootUri)
      ?? showRepositoryNotFound()
  }

  const selected = api.repositories.find(repository =>
    (repository as GitRepository & { ui?: { selected?: boolean } }).ui?.selected,
  )
  if (selected !== undefined)
    return selected
  if (api.repositories.length === 1)
    return api.repositories[0]

  void window.showWarningMessage(
    api.repositories.length === 0
      ? 'No Git repository is open.'
      : 'Run commit-message generation from the Source Control input of the repository to use.',
  )
  return undefined
}

/**
 * Assemble a per-file diff context for the given changes, bounded per file and
 * in total. Untracked files are rendered as synthetic new-file diffs.
 */
export async function collectChangeContext(
  repository: GitRepository,
  changes: readonly GitChange[],
  staged: boolean,
  token?: CancellationToken,
): Promise<string> {
  const untracked = new Set(repository.state.untrackedChanges.map(change => change.uri.toString()))
  const sorted = [...changes].sort((a, b) =>
    changePath(repository, a).localeCompare(changePath(repository, b)),
  )
  const chunks: string[] = []
  let length = 0
  let omitted = 0

  for (let index = 0; index < sorted.length; index++) {
    if (token?.isCancellationRequested)
      break

    const change = sorted[index]!
    const path = changePath(repository, change)
    let diff: string
    try {
      diff = untracked.has(change.uri.toString())
        ? await untrackedFileContext(change.uri, path)
        : staged
          ? await repository.diffIndexWithHEAD(change.uri.fsPath)
          : await repository.diffWithHEAD(change.uri.fsPath)
    }
    catch (error) {
      diff = `[Unable to read this change: ${errorMessage(error)}]`
    }

    const chunk = `### ${path}\n${truncateFileContext(diff)}`
    const separatorLength = chunks.length === 0 ? 0 : 2
    if (length + separatorLength + chunk.length > MAX_TOTAL_CONTEXT - TOTAL_LIMIT_RESERVE) {
      omitted = sorted.length - index
      break
    }
    chunks.push(chunk)
    length += separatorLength + chunk.length
  }

  if (omitted > 0)
    chunks.push(`[${omitted} additional file${omitted === 1 ? '' : 's'} omitted because the total context limit was reached.]`)

  return chunks.join('\n\n')
}

/** Deduplicate changes by URI, preserving first-seen order. */
export function uniqueChanges(changes: readonly GitChange[]): GitChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    const key = change.uri.toString()
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

function truncateFileContext(value: string): string {
  if (value.length <= MAX_FILE_CONTEXT)
    return value
  const marker = '\n[Diff truncated at the per-file context limit.]'
  return `${value.slice(0, MAX_FILE_CONTEXT - marker.length).trimEnd()}${marker}`
}

async function untrackedFileContext(uri: Uri, path: string): Promise<string> {
  const header = [
    `diff --git a/${path} b/${path}`,
    'new file',
    '--- /dev/null',
    `+++ b/${path}`,
  ].join('\n')
  const stat = await workspace.fs.stat(uri)
  if (stat.size > MAX_FILE_CONTEXT)
    return `${header}\n[Untracked file content omitted: ${stat.size} bytes exceeds the per-file limit.]`

  const data = await workspace.fs.readFile(uri)
  if (data.includes(0))
    return `${header}\n[Binary file content omitted.]`

  const text = new TextDecoder().decode(data)
  const added = text.split(/\r?\n/).map(line => `+${line}`).join('\n')
  return `${header}\n${added}`
}

function changePath(repository: GitRepository, change: GitChange): string {
  const path = relative(repository.rootUri.fsPath, change.uri.fsPath).replaceAll('\\', '/')
  return path.length > 0 ? path : change.uri.fsPath
}

function showRepositoryNotFound(): undefined {
  void window.showErrorMessage('The selected Git repository could not be opened.')
  return undefined
}
