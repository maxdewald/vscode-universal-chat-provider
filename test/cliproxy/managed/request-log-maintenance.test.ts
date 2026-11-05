import { readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { maintainRequestLogs } from '@src/cliproxy/managed/request-log-maintenance'
import { expect, it } from 'vitest'
import { useTempDirectories } from '../../support/temp'

const makeTempDirectory = useTempDirectories()

it('combines cooled request logs by day and removes logs outside 7-day retention', async () => {
  const logDir = await makeTempDirectory('ucp-request-logs-')
  const now = new Date(2026, 7, 23, 12)
  const cooled = new Date(now.getTime() - 3 * 60 * 1000)
  const first = 'v1-responses-2026-08-22T100000-first.log'
  const second = 'v1-responses-2026-08-22T110000-second.log'
  const recent = 'v1-responses-2026-08-23T115959-recent.log'
  const oldestRetained = 'v1-responses-2026-08-17T100000-retained.log'
  const expired = 'v1-responses-2026-08-16T100000-expired.log'

  await Promise.all([
    writeFile(join(logDir, first), 'first payload'),
    writeFile(join(logDir, second), 'second payload'),
    writeFile(join(logDir, recent), 'recent payload'),
    writeFile(join(logDir, oldestRetained), 'retained payload'),
    writeFile(join(logDir, expired), 'expired payload'),
    writeFile(join(logDir, 'requests-2026-08-17.log'), 'retained archive'),
    writeFile(join(logDir, 'requests-2026-08-16.log'), 'expired archive'),
  ])
  await Promise.all([first, second].map(async name => utimes(join(logDir, name), cooled, cooled)))

  await maintainRequestLogs(logDir, now)

  const names = (await readdir(logDir)).sort()
  expect(names).toEqual(['requests-2026-08-17.log', 'requests-2026-08-22.log', oldestRetained, recent].sort())
  expect(await readFile(join(logDir, 'requests-2026-08-17.log'), 'utf8')).toBe('retained archive')
  expect(await readFile(join(logDir, 'requests-2026-08-22.log'), 'utf8')).toBe(
    `===== BEGIN ${first} =====\nfirst payload\n===== END ${first} =====\n`
    + `===== BEGIN ${second} =====\nsecond payload\n===== END ${second} =====\n`,
  )
})
