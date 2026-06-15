import type { OutputChannel } from 'vscode'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogTailer } from '../../../src/cliproxy/managed/log-tailer'

describe('log tailer', () => {
  let dir: string
  let logPath: string
  let lines: string[]
  let channel: OutputChannel
  const tailers: LogTailer[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ucp-tailer-'))
    logPath = join(dir, 'cliproxy.log')
    lines = []
    channel = { appendLine: (line: string) => lines.push(line) } as unknown as OutputChannel
  })

  afterEach(async () => {
    for (const tailer of tailers.splice(0))
      tailer.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  function tail(seedBytes = 0): LogTailer {
    const tailer = new LogTailer(logPath, channel, { intervalMs: 20, seedBytes })
    tailers.push(tailer)
    return tailer.start()
  }

  it('streams lines appended after it starts, even before the file exists', async () => {
    tail()
    await appendFile(logPath, 'first\nsecond\n')
    await waitFor(() => lines.length >= 2)
    expect(lines).toEqual(['first', 'second'])
  })

  it('holds back a partial line until its newline arrives', async () => {
    await writeFile(logPath, '')
    tail()
    await appendFile(logPath, 'incom')
    await appendFile(logPath, 'plete\ndone\n')
    await waitFor(() => lines.length >= 2)
    expect(lines).toEqual(['incomplete', 'done'])
  })

  it('replays a recent tail and drops the leading fragment', async () => {
    // 'aaaaa\n' (6 bytes) + 'bbbbb\n' (6 bytes); seeding 8 bytes seeks mid-first-line.
    await writeFile(logPath, 'aaaaa\nbbbbb\n')
    tail(8)
    await waitFor(() => lines.length >= 1)
    expect(lines).toEqual(['bbbbb'])
  })

  it('restarts from the top when the file is truncated or rotated', async () => {
    await writeFile(logPath, 'old line\n')
    tail()
    await appendFile(logPath, 'before\n')
    await waitFor(() => lines.includes('before'))

    await writeFile(logPath, 'after\n')
    await waitFor(() => lines.includes('after'))
    expect(lines).toContain('after')
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for tailer output.')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
