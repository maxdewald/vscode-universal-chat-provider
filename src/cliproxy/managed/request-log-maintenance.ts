import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const RETENTION_DAYS = 14
const COOLING_MS = 2 * 60 * 1000
const REQUEST_LOG = /^.+-(\d{4}-\d{2}-\d{2})T\d{6}-.+\.log$/
const DAILY_LOG = /^requests-(\d{4}-\d{2}-\d{2})\.log$/

export async function maintainRequestLogs(logDir: string, now = new Date()): Promise<void> {
  const entries = await readdir(logDir, { withFileTypes: true }).catch(() => [])
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS + 1)
  const cutoffDate = localDate(cutoff)

  for (const entry of entries) {
    if (!entry.isFile())
      continue
    const dailyDate = DAILY_LOG.exec(entry.name)?.[1]
    const requestDate = REQUEST_LOG.exec(entry.name)?.[1]
    if ((dailyDate ?? requestDate) !== undefined && (dailyDate ?? requestDate)! < cutoffDate) {
      await rm(join(logDir, entry.name), { force: true })
      continue
    }
    if (requestDate === undefined)
      continue
    const source = join(logDir, entry.name)
    const sourceStat = await stat(source).catch(() => undefined)
    if (sourceStat === undefined || now.getTime() - sourceStat.mtimeMs < COOLING_MS)
      continue
    const destination = join(logDir, `requests-${requestDate}.log`)
    await appendFile(destination, `===== BEGIN ${entry.name} =====\n`, { mode: 0o600 })
    await pipeline(createReadStream(source), createWriteStream(destination, { flags: 'a' }))
    await appendFile(destination, `\n===== END ${entry.name} =====\n`)
    // ponytail: a crash during append may duplicate a partial request; add a journal only if that becomes a problem.
    await rm(source)
  }
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
