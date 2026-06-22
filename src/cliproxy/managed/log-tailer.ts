import type { Disposable, OutputChannel } from 'vscode'
import { createReadStream, statSync, unwatchFile, watchFile } from 'node:fs'

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
  private readonly listener: (curr: { size: number }) => void

  constructor(
    private readonly logPath: string,
    private readonly output: OutputChannel,
    options: LogTailerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.seedBytes = options.seedBytes ?? DEFAULT_SEED_BYTES
    this.listener = curr => this.onChange(curr.size)
  }

  start(): this {
    const size = this.currentSize()
    this.offset = Math.max(0, size - this.seedBytes)
    this.skipFirstLine = this.offset > 0 && this.offset < size
    watchFile(this.logPath, { interval: this.intervalMs }, this.listener)
    if (size > this.offset)
      this.onChange(size)
    return this
  }

  dispose(): void {
    unwatchFile(this.logPath, this.listener)
  }

  private onChange(size: number): void {
    if (size < this.offset) {
      this.offset = 0
      this.pending = ''
    }
    if (size <= this.offset)
      return
    if (this.reading) {
      this.rereadQueued = true
      return
    }
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
      this.onChange(this.currentSize())
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

  private currentSize(): number {
    try {
      return statSync(this.logPath).size
    }
    catch {
      return 0
    }
  }
}
