import type { Stats } from 'node:fs'
import type { Disposable, OutputChannel } from 'vscode'
import { createReadStream, statSync } from 'node:fs'

const DEFAULT_INTERVAL_MS = 500
const DEFAULT_SEED_BYTES = 32 * 1024

export interface LogTailerOptions {
  intervalMs?: number
  seedBytes?: number
}

export class LogTailer implements Disposable {
  private readonly intervalMs: number
  private readonly seedBytes: number
  private offset = 0
  private pending = ''
  private skipFirstLine = false
  private reading = false
  private rereadQueued = false
  private restartQueued = false
  private stats: Stats | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly logPath: string,
    private readonly output: OutputChannel,
    options: LogTailerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.seedBytes = options.seedBytes ?? DEFAULT_SEED_BYTES
  }

  start(): this {
    this.stats = this.currentStats()
    const size = this.stats?.size ?? 0
    this.offset = Math.max(0, size - this.seedBytes)
    this.skipFirstLine = this.offset > 0 && this.offset < size
    this.timer = setInterval(() => this.poll(), this.intervalMs)
    if (size > this.offset)
      this.onChange(size)
    return this
  }

  dispose(): void {
    clearInterval(this.timer)
  }

  private poll(restart = false): void {
    const stats = this.currentStats()
    if (stats === undefined)
      return
    restart ||= stats.size < this.offset
      || (this.stats !== undefined && (stats.dev !== this.stats.dev || stats.ino !== this.stats.ino))
    this.stats = stats
    this.onChange(stats.size, restart)
  }

  private onChange(size: number, restart = size < this.offset): void {
    if (this.reading) {
      this.rereadQueued = true
      this.restartQueued ||= restart
      return
    }
    if (restart) {
      this.offset = 0
      this.pending = ''
      this.skipFirstLine = false
    }
    if (size <= this.offset)
      return
    this.reading = true
    const target = size
    const stream = createReadStream(this.logPath, { start: this.offset, end: target - 1, encoding: 'utf8' })
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
    })
    stream.on('error', () => this.finishRead())
    stream.on('end', () => this.finishRead({ buffer, target }))
  }

  private finishRead(result?: { buffer: string, target: number }): void {
    if (result !== undefined) {
      this.offset = result.target
      this.emit(result.buffer)
    }
    this.reading = false
    if (this.rereadQueued) {
      this.rereadQueued = false
      const restart = this.restartQueued
      this.restartQueued = false
      this.poll(restart)
    }
  }

  private emit(text: string): void {
    const lines = (this.pending + text).split(/\r?\n/)
    this.pending = lines.pop() ?? ''
    let index = 0
    if (this.skipFirstLine) {
      this.skipFirstLine = false
      index = 1
    }
    for (; index < lines.length; index++)
      this.output.appendLine(lines[index]!)
  }

  private currentStats(): Stats | undefined {
    try {
      return statSync(this.logPath)
    }
    catch {
      return undefined
    }
  }
}
