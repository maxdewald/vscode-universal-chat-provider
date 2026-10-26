import type { ProviderModel } from '@src/chat/models/model'
import type { ProxyConnection } from '@src/cliproxy/connection'
import type { Disposable, ExtensionContext, LogOutputChannel, Memento } from 'vscode'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { Type } from '@sinclair/typebox'
import { CredentialStore } from '@src/cliproxy/configuration/credentials'
import { errorMessage } from '@src/shared/errors'
import { asValue } from '@src/shared/json'
import { kyFetch } from '@src/shared/kyFetch'
import { commands, ConfigurationTarget, StatusBarAlignment, ThemeColor, window, workspace } from 'vscode'

const SAMPLE_RATE = 16000
const FRAME_LENGTH = 1600
const FRAME_MS = FRAME_LENGTH / SAMPLE_RATE * 1000
const MAX_SECONDS = 120
const FINAL_TRANSCRIPT_TIMEOUT_MS = 15_000
const SILENCE_PEAK = 50
// Shorter takes are treated as accidental toggles and end quietly.
const MIN_RECORDING_MS = 1500
const BLINK_MS = 500
const BLINK_TICKS = 30
const VOCABULARY_HINT = 'Software development dictation; keep code terms, file names, and identifiers as spoken.'

const COMMON_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'tr', 'ru', 'uk', 'ja', 'ko', 'zh', 'hi', 'ar']
const BUTTON_CHOICE_KEY = 'dictation.builtInButtonChoice'
const englishNames = new Intl.DisplayNames(['en'], { type: 'language' })

const dictationSettings = (): ReturnType<typeof workspace.getConfiguration> => workspace.getConfiguration('universalChatProvider.dictation')
export const dictationEngine = (): string => dictationSettings().get<string>('engine', '').trim()
export const dictationMicrophone = (): string => dictationSettings().get<string>('microphone', '')

function systemLanguage(): string {
  return new Intl.Locale(new Intl.DateTimeFormat().resolvedOptions().locale).language
}

function configuredLanguage(): string {
  return dictationSettings().get<string>('language', '').trim().toLowerCase()
}

function resolvedLanguage(): string {
  return configuredLanguage() || systemLanguage()
}

function languageName(code: string): string {
  if (code === 'auto')
    return 'Automatic'
  const english = englishNames.of(code) ?? code
  const native = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
  return english === native ? english : `${english} (${native})`
}

export function dictationLanguageLabel(): string {
  return languageName(resolvedLanguage())
}

// Unset means not chosen yet: take the OS language once and save it, so it stays put until the user changes it.
export function dictationLanguage(): string | undefined {
  const language = resolvedLanguage()
  if (!configuredLanguage())
    void dictationSettings().update('language', language, ConfigurationTarget.Global)
  return language === 'auto' ? undefined : language
}

export async function selectLanguage(): Promise<void> {
  const system = systemLanguage()
  const current = resolvedLanguage()
  const mark = (code: string, note: string): string => [note, code === current ? 'current' : ''].filter(Boolean).join(' · ')
  const picked = await window.showQuickPick(
    [
      ...[...new Set([system, ...COMMON_LANGUAGES])].map(code => ({ label: languageName(code), code, description: mark(code, code === system ? 'system' : '') })),
      { label: 'Automatic', code: 'auto', description: mark('auto', 'no hint, the engine guesses') },
    ],
    { title: 'Dictation Language', matchOnDescription: true },
  )
  if (picked !== undefined)
    await dictationSettings().update('language', picked.code, ConfigurationTarget.Global)
}

export function clipPrompt(language: string | undefined): string {
  const languageName = language === undefined ? undefined : englishNames.of(language)
  return [
    'Transcribe this audio verbatim. Output only the transcript, nothing else.',
    languageName === undefined ? '' : `The speaker is most likely speaking ${languageName}; transcribe in the language actually spoken.`,
    VOCABULARY_HINT,
  ].filter(Boolean).join(' ')
}

const NATIVE_DIRS: Partial<Record<string, string>> = {
  'darwin-arm64': 'mac/arm64',
  'darwin-x64': 'mac/x86_64',
  'linux-x64': 'linux/x86_64',
  'win32-x64': 'windows/amd64',
  'win32-arm64': 'windows/arm64',
}

interface NativeRecorder {
  get_available_devices: () => string[]
  init: (frameLength: number, deviceIndex: number, bufferedFrames: number) => { handle: unknown, status: number }
  start: (handle: unknown) => number
  read: (handle: unknown, pcm: Int16Array) => number
  stop: (handle: unknown) => number
  delete: (handle: unknown) => void
}

type ModelRef = Pick<ProviderModel, 'proxyModelId' | 'proxyOwner'>

// The proxy doesn't list Codex transcription models, so these are known IDs; any other transcribe/whisper ID typed into the setting works too.
const LIVE_ENGINES: Record<string, string> = {
  'gpt-transcribe': 'Codex · most accurate overall · fastest',
  'gpt-live-transcribe': 'Codex · best on long dictation, weaker on casual speech · fastest',
}
const CLIP_HINTS: Record<string, string> = {
  'gemini-3-flash': 'Gemini · good on plain speech, weaker on code terms · slower',
  'gemini-3.1-flash-lite': 'Gemini · like 3 Flash · slower',
  'gemini-3.5-flash-lite': 'Gemini · like 3 Flash · slower',
  'gemini-3.8-flash-high': 'Gemini · slowest, not more accurate',
}

export const isLiveEngine = (engine: string): boolean => /transcribe|whisper/.test(engine)

export function engineChoices(models: readonly ModelRef[]): Array<{ id: string, label: string, description: string }> {
  const codex = models.some(entry => entry.proxyOwner === 'openai' && entry.proxyModelId.startsWith('gpt-'))
  return [
    { id: '', label: 'None', description: 'Dictation off' },
    ...Object.entries(LIVE_ENGINES).filter(() => codex).map(([id, description]) => ({ id, label: id, description })),
    ...models
      .filter(entry => entry.proxyModelId.startsWith('gemini-') && !entry.proxyModelId.includes('image'))
      .map(({ proxyModelId: id }) => ({ id, label: id, description: CLIP_HINTS[id] ?? 'Gemini · transcribes after you stop' })),
  ]
}

export async function* record(extensionPath: string, signal: AbortSignal, deviceIndex = -1): AsyncGenerator<Int16Array> {
  const native = loadRecorder(extensionPath)
  const { handle, status } = native.init(FRAME_LENGTH, deviceIndex, 50)
  check(status, 'open the microphone')
  try {
    check(native.start(handle), 'start recording')
    const startedAt = Date.now()
    for (let frame = 0; frame < MAX_SECONDS * 1000 / FRAME_MS && !signal.aborted; frame++) {
      // ponytail: read() blocks until a frame is buffered, so sleep until it nearly is; move to a worker if it stalls the host.
      await delay(Math.max(0, startedAt + (frame + 1) * FRAME_MS - 5 - Date.now()))
      const pcm = new Int16Array(FRAME_LENGTH)
      check(native.read(handle, pcm), 'read audio')
      yield pcm
    }
  }
  finally {
    native.stop(handle)
    native.delete(handle)
  }
}

export function listMicrophones(extensionPath: string): string[] {
  return loadRecorder(extensionPath).get_available_devices()
}

function loadRecorder(extensionPath: string): NativeRecorder {
  const dir = NATIVE_DIRS[`${process.platform}-${process.arch}`]
  if (dir === undefined)
    throw new Error(`Dictation is not supported on ${process.platform}-${process.arch}.`)
  const module = { exports: {} as NativeRecorder }
  process.dlopen(module, join(extensionPath, 'dist', 'native', '@picovoice', 'pvrecorder-node', 'lib', dir, 'pv_recorder.node'))
  return module.exports
}

function check(status: number, action: string): void {
  if (status !== 0)
    throw new Error(`Couldn't ${action} (recorder status ${status}). Check that VS Code may use the microphone.`)
}

export function upsample16kTo24k(input: Int16Array): Int16Array {
  const output = new Int16Array(Math.floor(input.length * 3 / 2))
  for (let index = 0; index < output.length; index++) {
    const position = index * 2 / 3
    const left = Math.floor(position)
    const from = input[left]!
    const to = input[Math.min(left + 1, input.length - 1)]!
    output[index] = Math.round(from + (to - from) * (position - left))
  }
  return output
}

export function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

const LiveEventSchema = Type.Object({
  type: Type.String(),
  item_id: Type.Optional(Type.String()),
  delta: Type.Optional(Type.String()),
  transcript: Type.Optional(Type.String()),
  error: Type.Optional(Type.Object({ code: Type.Optional(Type.String()), message: Type.Optional(Type.String()) })),
})

export async function transcribeLive(baseUrl: string, apiKey: string, model: string, audio: AsyncIterable<Int16Array>, language?: string): Promise<string> {
  // Node's WebSocket (undici) accepts headers; the DOM typing does not know that.
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/v1/realtime?model=gpt-realtime`, { headers: { Authorization: `Bearer ${apiKey}` } })
  const order: string[] = []
  const texts = new Map<string, string>()
  const pending = new Set<string>()
  let stopped = false
  let failed = false
  let finalCommitSettled = false
  const transcript = (): string => order.map(id => texts.get(id)?.trim()).filter(Boolean).join(' ')
  const track = (id: string): void => {
    if (!order.includes(id))
      order.push(id)
  }

  const done = new Promise<string>((resolve, reject) => {
    const finishIfDone = (): void => {
      if (stopped && finalCommitSettled && pending.size === 0)
        resolve(transcript())
    }
    socket.onmessage = (event) => {
      const message = asValue(LiveEventSchema, JSON.parse(String(event.data)))
      if (message === undefined)
        return
      const id = message.item_id
      switch (message.type) {
        case 'input_audio_buffer.committed':
          if (id !== undefined) {
            track(id)
            pending.add(id)
          }
          finalCommitSettled ||= stopped
          break
        case 'conversation.item.input_audio_transcription.delta':
          if (id !== undefined) {
            track(id)
            texts.set(id, (texts.get(id) ?? '') + (message.delta ?? ''))
          }
          break
        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.failed':
          if (id !== undefined) {
            texts.set(id, message.transcript ?? '')
            pending.delete(id)
          }
          break
        case 'error':
          // An empty recording leaves nothing to commit.
          if (stopped && message.error?.code === 'input_audio_buffer_commit_empty')
            finalCommitSettled = true
          else
            reject(new Error(message.error?.message ?? 'Realtime transcription failed.'))
          break
        default:
          break
      }
      finishIfDone()
    }
    socket.onclose = () => reject(new Error('The realtime connection closed before the transcript was complete.'))
  })
  done.catch(() => {
    failed = true
  })

  try {
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('Couldn\'t connect to the CLIProxyAPI realtime endpoint.'))
    })
    socket.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        audio: { input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model, prompt: VOCABULARY_HINT, ...(language === undefined ? {} : { language }) },
          // Benchmarked: one commit at stop beat every VAD setting, which clipped word onsets and split sentences at pauses.
          turn_detection: null,
          noise_reduction: null,
        } },
      },
    }))
    for await (const frame of audio) {
      if (failed || socket.readyState !== WebSocket.OPEN)
        break
      const upsampled = upsample16kTo24k(frame)
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(upsampled.buffer).toString('base64') }))
    }
    stopped = true
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    return await Promise.race([
      done,
      delay(FINAL_TRANSCRIPT_TIMEOUT_MS).then(() => {
        throw new Error('Timed out waiting for the final transcript.')
      }),
    ])
  }
  finally {
    socket.close()
  }
}

const ChatCompletionSchema = Type.Object({
  choices: Type.Optional(Type.Array(Type.Object({ message: Type.Optional(Type.Object({ content: Type.Optional(Type.String()) })) }))),
})

export async function transcribeClip(baseUrl: string, apiKey: string, model: string, audio: AsyncIterable<Int16Array>, language?: string): Promise<string> {
  const frames: Buffer[] = []
  for await (const frame of audio)
    frames.push(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
  const response = await kyFetch.post(`${baseUrl}/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    json: {
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: clipPrompt(language) },
        { type: 'input_audio', input_audio: { data: wav(Buffer.concat(frames), SAMPLE_RATE).toString('base64'), format: 'wav' } },
      ] }],
    },
    timeout: 60_000,
  }).json()
  return asValue(ChatCompletionSchema, response)?.choices?.[0]?.message?.content?.trim() ?? ''
}

export async function selectEngine(models: readonly ModelRef[], state: Memento): Promise<void> {
  const settings = dictationSettings()
  const current = settings.get<string>('engine', '')
  const picked = await window.showQuickPick(
    engineChoices(models).map(choice => choice.id === current ? { ...choice, description: `${choice.description} · current` } : choice),
    { title: 'Dictation Engine', placeHolder: 'Uses unofficial endpoints; may break' },
  )
  if (picked === undefined)
    return
  await settings.update('engine', picked.id, ConfigurationTarget.Global)
  if (picked.id && state.get(BUTTON_CHOICE_KEY) === undefined && workspace.getConfiguration('dictation').get<boolean>('showButton', true)) {
    const choice = await window.showInformationMessage('Hide VS Code\'s own dictation button in the chat input? Universal Chat Provider dictation uses the mic in the status bar.', 'Hide', 'Keep')
    if (choice === undefined)
      return
    await state.update(BUTTON_CHOICE_KEY, choice)
    if (choice === 'Hide')
      await workspace.getConfiguration('dictation').update('showButton', false, ConfigurationTarget.Global)
  }
}

// Mono WAV copies of VS Code's own recording sounds; WAV plays with each OS's built-in player.
export function playRecordingSound(extensionPath: string, kind: 'Started' | 'Stopped', onError: (message: string) => void): void {
  const sound = workspace.getConfiguration('accessibility.signals', null).get<{ sound?: string }>(`voiceRecording${kind}`)?.sound ?? 'on'
  if (!['on', 'always', 'userGesture'].includes(sound))
    return
  const file = join(extensionPath, 'media', `voiceRecording${kind}.wav`)
  if (process.platform === 'darwin')
    execFile('afplay', [file], error => error && onError(error.message))
  else if (process.platform === 'win32')
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${file.replaceAll('\'', '\'\'')}').PlaySync()`], { windowsHide: true }, error => error && onError(error.message))
  else
    execFile('paplay', [file], error => error && execFile('aplay', ['-q', file], fallbackError => fallbackError && onError(fallbackError.message)))
}

export async function selectMicrophone(extensionPath: string): Promise<void> {
  const settings = dictationSettings()
  const current = settings.get<string>('microphone', '')
  const picked = await window.showQuickPick(
    ['', ...listMicrophones(extensionPath)].map(name => ({
      label: name || 'System Default',
      name,
      ...(name === current ? { description: 'current' } : {}),
    })),
    { title: 'Dictation Microphone' },
  )
  if (picked !== undefined)
    await settings.update('microphone', picked.name, ConfigurationTarget.Global)
}

export function createDictateCommand(
  context: ExtensionContext,
  models: (interactive: boolean) => Promise<readonly ModelRef[]>,
  connection: ProxyConnection,
  output: LogOutputChannel,
): { run: () => Promise<void>, disposables: Disposable[] } {
  let active: AbortController | undefined
  // The chat input toolbar forwards its chat widget, which can't be serialized to the extension host, so its clicks never arrive.
  const button = window.createStatusBarItem(StatusBarAlignment.Right, 98)
  button.command = 'universalChatProvider.dictate'
  const render = (state: 'idle' | 'recording' | 'transcribing'): void => {
    button.text = { idle: '$(mic)', recording: '$(debug-stop) Dictating', transcribing: '$(loading~spin) Transcribing' }[state]
    button.tooltip = { idle: 'Dictate to Chat', recording: 'Stop dictation', transcribing: 'Transcribing…' }[state]
    button.backgroundColor = state === 'recording' ? new ThemeColor('statusBarItem.errorBackground') : undefined
  }
  const syncVisibility = (): void => {
    if (dictationEngine())
      button.show()
    else
      button.hide()
  }
  let blinking: NodeJS.Timeout | undefined
  const stopBlinking = (): void => {
    clearInterval(blinking)
    blinking = undefined
  }
  const blink = (): void => {
    stopBlinking()
    let tick = 0
    blinking = setInterval(() => {
      if (active !== undefined || ++tick > BLINK_TICKS) {
        stopBlinking()
        if (active === undefined)
          render('idle')
        return
      }
      button.text = '$(mic-filled) Dictate'
      button.backgroundColor = tick % 2 ? new ThemeColor('statusBarItem.warningBackground') : undefined
    }, BLINK_MS)
  }
  render('idle')
  syncVisibility()
  let wasOn = Boolean(dictationEngine())
  const configListener = workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('universalChatProvider.dictation.engine'))
      return
    syncVisibility()
    const isOn = Boolean(dictationEngine())
    if (isOn && !wasOn)
      blink()
    // VS Code's own dictation button follows ours when the user chose to hide it.
    if (isOn !== wasOn && context.globalState.get(BUTTON_CHOICE_KEY) === 'Hide')
      void workspace.getConfiguration('dictation').update('showButton', isOn ? false : undefined, ConfigurationTarget.Global)
    wasOn = isOn
  })

  const run = async (): Promise<void> => {
    if (active !== undefined) {
      output.info('Dictation stopping.')
      active.abort()
      return
    }
    const engine = dictationEngine()
    if (!engine) {
      await selectEngine(await models(false), context.globalState)
      return
    }
    const apiKey = await new CredentialStore(context).get()
    if (apiKey === undefined) {
      void window.showWarningMessage('Connect Universal Chat Provider before using dictation.')
      return
    }

    const recording = active = new AbortController()
    render('recording')
    const soundFailed = (message: string): void => output.warn(`Dictation sound couldn't play: ${message}`)
    playRecordingSound(context.extensionPath, 'Started', soundFailed)
    recording.signal.addEventListener('abort', () => {
      render('transcribing')
      playRecordingSound(context.extensionPath, 'Stopped', soundFailed)
    })
    const release = await connection.acquireRequest()
    try {
      const microphone = dictationMicrophone()
      const deviceIndex = microphone ? listMicrophones(context.extensionPath).indexOf(microphone) : -1
      if (microphone && deviceIndex === -1)
        output.warn(`Microphone "${microphone}" isn't connected; using the system default.`)
      const language = dictationLanguage()
      output.info(`Dictation started with ${engine} on ${microphone || 'the system default microphone'}, language ${language ?? 'auto'}.`)
      const startedAt = Date.now()
      let peak = 0
      async function* metered(): AsyncGenerator<Int16Array> {
        for await (const frame of record(context.extensionPath, recording.signal, deviceIndex)) {
          for (const sample of frame)
            peak = Math.max(peak, Math.abs(sample))
          yield frame
        }
      }
      const text = isLiveEngine(engine)
        ? await transcribeLive(connection.baseUrl(), apiKey, engine, metered(), language)
        : await transcribeClip(connection.baseUrl(), apiKey, engine, metered(), language)
      output.info(`Dictation finished: peak level ${peak}, ${text.length} characters.`)
      if (text) {
        await commands.executeCommand('workbench.action.chat.open')
        await commands.executeCommand('workbench.action.chat.focusInput')
        // `type` inserts at the cursor of the focused editor, keeping whatever the user already wrote.
        await commands.executeCommand('type', { text: `${text} ` })
      }
      else if (peak < SILENCE_PEAK && Date.now() - startedAt >= MIN_RECORDING_MS) {
        void window.showWarningMessage(`Dictation heard only silence from ${microphone || 'the system default microphone'}. Pick another microphone or check that VS Code may use it.`, 'Select Microphone').then(async choice => choice && selectMicrophone(context.extensionPath))
      }
      else if (peak >= SILENCE_PEAK) {
        void window.showInformationMessage('Dictation didn\'t recognize any speech.')
      }
    }
    catch (error) {
      const message = `Dictation failed: ${errorMessage(error)}`
      output.error(message)
      void window.showErrorMessage(message)
    }
    finally {
      recording.abort()
      release()
      active = undefined
      render('idle')
    }
  }
  return { run, disposables: [button, configListener, { dispose: stopBlinking }] }
}
