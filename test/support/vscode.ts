import type * as vscode from 'vscode'
import type { ExtensionContext } from 'vscode'
import { createVSCodeMock } from 'jest-mock-vscode'
import { vi } from 'vitest'

// Value-types/enums come from jest-mock-vscode; the LM provider API, env, extensions,
// CancellationTokenSource and the behavioral fakes below are hand-written (jmv omits them).
const base = createVSCodeMock(vi) as unknown as typeof vscode

export const { Uri, EventEmitter, MarkdownString, ThemeColor, ConfigurationTarget, StatusBarAlignment, ProgressLocation, LanguageModelDataPart } = base

class MockDisposable {
  disposed = false

  constructor(private readonly callback: () => void = () => {}) {}

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.callback()
  }
}

export class CancellationTokenSource {
  private readonly emitter = new EventEmitter<void>()
  token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event,
  }

  cancel(): void {
    this.token.isCancellationRequested = true
    this.emitter.fire()
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
  System = 3,
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}

export class LanguageModelTextPart {
  constructor(readonly value: string) {}
}

export class LanguageModelThinkingPart {
  constructor(
    readonly value: string,
    readonly id?: string,
  ) {}
}

export class LanguageModelToolCallPart {
  constructor(
    readonly callId: string,
    readonly name: string,
    readonly input: object,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    readonly callId: string,
    readonly content: unknown[],
  ) {}
}

export class LanguageModelError extends Error {
  static NoPermissions(message = 'No permissions'): LanguageModelError {
    return new LanguageModelError(message, 'NoPermissions')
  }

  static Blocked(message = 'Blocked'): LanguageModelError {
    return new LanguageModelError(message, 'Blocked')
  }

  static NotFound(message = 'Not found'): LanguageModelError {
    return new LanguageModelError(message, 'NotFound')
  }

  private constructor(message: string, readonly code: string) {
    super(message)
  }
}

const settings = new Map<string, unknown>()
const secrets = new Map<string, string>()
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>()

export interface MockOutputChannel {
  name: string
  appendLine: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

export interface MockStatusBarItem {
  text: string
  tooltip: string | vscode.MarkdownString | undefined
  command: string | undefined
  backgroundColor: vscode.ThemeColor | undefined
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

export interface MockQuickPick {
  title: string
  placeholder: string
  busy: boolean
  items: unknown[]
  activeItems: unknown[]
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  onDidAccept: ReturnType<typeof vi.fn>
  onDidTriggerItemButton: ReturnType<typeof vi.fn>
  onDidHide: ReturnType<typeof vi.fn>
}

export function createOutputChannelMock(name = 'Test Output'): MockOutputChannel {
  return {
    name,
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  }
}

export function createStatusBarItemMock(): MockStatusBarItem {
  return {
    text: '',
    tooltip: '',
    command: undefined,
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }
}

export function createQuickPickMock(): MockQuickPick {
  return {
    title: '',
    placeholder: '',
    busy: false,
    items: [],
    activeItems: [],
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    onDidAccept: vi.fn(),
    onDidTriggerItemButton: vi.fn(),
    onDidHide: vi.fn(),
  }
}

const outputChannels: MockOutputChannel[] = []
const statusBarItems: Array<{ alignment: number | undefined, priority: number | undefined, item: MockStatusBarItem }> = []
const quickPicks: MockQuickPick[] = []

export const vscodeMock = {
  settings,
  secrets,
  commandHandlers,
  registeredProviders: [] as Array<{ vendor: string, provider: unknown }>,
  output: createOutputChannelMock(),
  outputChannels,
  statusBarItems,
  quickPicks,
}

export const statusBarItem = createStatusBarItemMock()
export const quickPick = createQuickPickMock()

export function outputChannelByName(name: string): MockOutputChannel | undefined {
  return outputChannels.find(channel => channel.name === name)
}

export function statusBarItemByPriority(priority: number): MockStatusBarItem | undefined {
  return statusBarItems.find(entry => entry.priority === priority)?.item
}

export function latestQuickPick(): MockQuickPick | undefined {
  return quickPicks.at(-1)
}

export async function triggerQuickPickItemButton(
  event: { item: unknown, button: unknown },
  picker: MockQuickPick = latestQuickPick() ?? quickPick,
): Promise<void> {
  const listener: unknown = picker.onDidTriggerItemButton.mock.calls[0]?.[0]
  if (typeof listener !== 'function')
    throw new TypeError('No Quick Pick item-button listener was registered.')
  await (listener as (event: { item: unknown, button: unknown }) => unknown)(event)
}

export async function triggerQuickPickAccept(picker: MockQuickPick = latestQuickPick() ?? quickPick, item?: unknown): Promise<void> {
  if (item !== undefined)
    picker.activeItems = [item]
  const listener: unknown = picker.onDidAccept.mock.calls[0]?.[0]
  if (typeof listener !== 'function')
    throw new TypeError('No Quick Pick accept listener was registered.')
  await (listener as () => unknown)()
}

function createWatcher(): { onDidCreate: () => MockDisposable, onDidChange: () => MockDisposable, onDidDelete: () => MockDisposable, dispose: () => void } {
  return {
    onDidCreate: () => new MockDisposable(),
    onDidChange: () => new MockDisposable(),
    onDidDelete: () => new MockDisposable(),
    dispose: () => {},
  }
}

export const window = {
  createOutputChannel: vi.fn((name: string = 'Test Output', _options?: unknown) => {
    const channel = createOutputChannelMock(name)
    outputChannels.push(channel)
    return channel
  }),
  createStatusBarItem: vi.fn((alignment?: number, priority?: number) => {
    const item = createStatusBarItemMock()
    statusBarItems.push({ alignment, priority, item })
    return item
  }),
  createQuickPick: vi.fn(() => {
    const picker = createQuickPickMock()
    quickPicks.push(picker)
    return picker
  }),
  showInformationMessage: vi.fn(async (_message?: string, ..._items: unknown[]) => undefined as string | undefined),
  showWarningMessage: vi.fn(async (_message?: string, ..._items: unknown[]) => undefined as string | undefined),
  showErrorMessage: vi.fn(async (_message?: string, ..._items: unknown[]) => undefined as string | undefined),
  showInputBox: vi.fn(async (_options?: { validateInput?: (value: string) => string | undefined }) =>
    undefined as string | undefined),
  showQuickPick: vi.fn(async (_items?: unknown, _options?: unknown): Promise<unknown> =>
    undefined),
  withProgress: vi.fn(async (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: () => new MockDisposable() })),
}

export const workspace = {
  getConfiguration: vi.fn((section: string) => ({
    get<T>(key: string, fallback?: T): T {
      const value = settings.get(`${section}.${key}`)
      return (value === undefined ? fallback : value) as T
    },
    async update(key: string, value: unknown): Promise<void> {
      settings.set(`${section}.${key}`, value)
    },
  })),
  createFileSystemWatcher: vi.fn((_pattern: unknown) => createWatcher()),
  onDidChangeConfiguration: vi.fn((_listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => new MockDisposable()),
  fs: {
    stat: vi.fn(async (_uri: vscode.Uri) => ({ size: 0 })),
    readFile: vi.fn(async (_uri: vscode.Uri) => new Uint8Array()),
  },
}

export const env = {
  language: 'en',
  openExternal: vi.fn(async (_uri: vscode.Uri) => true),
}

export const extensions = {
  getExtension: vi.fn(),
}

export const commands = {
  registerCommand: vi.fn((command: string, handler: (...args: unknown[]) => unknown) => {
    commandHandlers.set(command, handler)
    return new MockDisposable(() => commandHandlers.delete(command))
  }),
  executeCommand: vi.fn(async (command: string, ...args: unknown[]) => {
    return await commandHandlers.get(command)?.(...args)
  }),
}

export const lm = {
  registerLanguageModelChatProvider: vi.fn((vendor: string, provider: unknown) => {
    vscodeMock.registeredProviders.push({ vendor, provider })
    return new MockDisposable()
  }),
}

export function createExtensionContext(options: {
  globalStoragePath?: string
  globalState?: Map<string, unknown>
  secrets?: Map<string, string>
} = {}): ExtensionContext {
  const globalState = options.globalState ?? new Map<string, unknown>()
  const contextSecrets = options.secrets ?? secrets
  return {
    subscriptions: [],
    globalStorageUri: options.globalStoragePath === undefined
      ? undefined
      : { fsPath: options.globalStoragePath },
    globalState: {
      get: <T>(key: string, fallback?: T): T => (globalState.get(key) ?? fallback) as T,
      update: async (key: string, value: unknown) => {
        globalState.set(key, value)
      },
    },
    secrets: {
      get: async (key: string) => contextSecrets.get(key),
      store: async (key: string, value: string) => {
        contextSecrets.set(key, value)
      },
      delete: async (key: string) => {
        contextSecrets.delete(key)
      },
      onDidChange: () => new MockDisposable(),
    },
  } as unknown as ExtensionContext
}

export function resetVSCodeMock(): void {
  settings.clear()
  secrets.clear()
  commandHandlers.clear()
  vscodeMock.registeredProviders.length = 0
  outputChannels.length = 0
  statusBarItems.length = 0
  quickPicks.length = 0
  for (const mock of [vscodeMock.output.appendLine, vscodeMock.output.show, vscodeMock.output.dispose])
    mock.mockReset()
  for (const value of Object.values(window))
    value.mockReset()
  window.createOutputChannel.mockImplementation((name: string = 'Test Output') => {
    const channel = createOutputChannelMock(name)
    outputChannels.push(channel)
    return channel
  })
  window.createStatusBarItem.mockImplementation((alignment?: number, priority?: number) => {
    const item = createStatusBarItemMock()
    statusBarItems.push({ alignment, priority, item })
    return item
  })
  window.createQuickPick.mockImplementation(() => {
    const picker = createQuickPickMock()
    quickPicks.push(picker)
    return picker
  })
  window.withProgress.mockImplementation(async (_options, task) =>
    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: () => new MockDisposable() }))
  Object.assign(statusBarItem, createStatusBarItemMock())
  Object.assign(quickPick, createQuickPickMock())
  workspace.fs.stat.mockReset()
  workspace.fs.readFile.mockReset()
  workspace.fs.stat.mockResolvedValue({ size: 0 })
  workspace.fs.readFile.mockResolvedValue(new Uint8Array())
  env.language = 'en'
  env.openExternal.mockReset()
  env.openExternal.mockResolvedValue(true)
  extensions.getExtension.mockReset()
}
