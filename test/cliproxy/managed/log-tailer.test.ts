import type { OutputChannel } from 'vscode'
import { appendFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LogTailer } from '@src/cliproxy/managed/log-tailer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTempDirectories } from '../../support/temp'

const makeTempDirectory = useTempDirectories()

describe('log tailer', () => {
  let dir: string
  let logPath: string
  let lines: string[]
  let channel: OutputChannel
  const tailers: LogTailer[] = []

  beforeEach(async () => {
    dir = await makeTempDirectory('ucp-tailer-')
    logPath = join(dir, 'cliproxy.log')
    lines = []
    channel = { appendLine: (line: string) => lines.push(line) } as unknown as OutputChannel
  })

  afterEach(async () => {
    for (const tailer of tailers.splice(0))
      tailer.dispose()
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
    await writeFile(logPath, 'aaaaa\nbbbbb\n')
    tail(8)
    await waitFor(() => lines.length >= 1)
    expect(lines).toEqual(['bbbbb'])
  })

  it('restarts from the top when the file is truncated', async () => {
    await writeFile(logPath, 'old line\n')
    tail()
    await appendFile(logPath, 'before\n')
    await waitFor(() => lines.includes('before'))

    await writeFile(logPath, 'after\n')
    await waitFor(() => lines.includes('after'))
    expect(lines).toContain('after')
  })

  it('restarts from the top when the file is rotated', async () => {
    await writeFile(logPath, 'old line\n')
    tail()
    await appendFile(logPath, 'before\n')
    await waitFor(() => lines.includes('before'))

    await rename(logPath, `${logPath}.1`)
    await writeFile(logPath, 'after rotation\n')
    await waitFor(() => lines.includes('after rotation'))
    expect(lines).toContain('after rotation')
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for tailer output.')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
