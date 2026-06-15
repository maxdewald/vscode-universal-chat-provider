import type { Disposable, OutputChannel } from 'vscode'
import { createReadStream, statSync, unwatchFile, watchFile } from 'node:fs'

/** How often to poll the log file for growth. */
const DEFAULT_INTERVAL_MS = 500
/** Replay at most this many trailing bytes of an existing log on start. */
const DEFAULT_SEED_BYTES = 32 * 1024

export interface LogTailerOptions {
  intervalMs?: number
  seedBytes?: number
}

/**
 * Follows the managed server's `cliproxy.log` and streams appended lines into a
 * VS Code output channel — a `tail -f` that any window can run.
 *
 * It tails the shared log *file* rather than a child's stdout because the
 * sidecar is a detached daemon that other windows merely adopt (and so hold no
 * child handle for): the file is the one sink every window can read. Polling
 * (`watchFile`) is used over `fs.watch` for reliable cross-platform detection of
 * appends, and it fires even before the file exists — so a tailer started ahead
 * of the first spawn picks up output as soon as the log appears.
 */
export class LogTailer implements Disposable {
  private readonly intervalMs: number
  private readonly seedBytes: number
  /** Byte offset up to which the file has already been streamed. */
  private offset = 0
  /** An incomplete final line, held until its newline arrives in a later append. */
  private pending = ''
  /** The leading line of a seeked-into seed is a fragment; drop it once. */
  private skipFirstLine = false
  private reading = false
  /** A poll fired mid-read; coalesce it into a single follow-up pass. */
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
    // Replay only a recent tail of the (append-across-restarts, potentially
    // huge) log so the channel has context without dumping the whole backlog.
    this.offset = Math.max(0, size - this.seedBytes)
    // Seeking strictly inside existing content lands mid-line; drop that
    // leading fragment once. (At EOF — offset === size — nothing is replayed.)
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
      // The file shrank: it was truncated or rotated. Start over from the top.
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
    // `encoding` makes the stream emit decoded strings at runtime; the typings
    // still widen to Buffer, so normalize with toString().
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
    // The trailing element is whatever follows the last newline — an incomplete
    // line we hold back so a line is never split across two appendLine calls.
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
