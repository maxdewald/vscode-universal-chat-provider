/* eslint-disable no-console */

import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { parse } from 'yaml'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const TEMP_DIR = join(ROOT, 'temp', 'showcase')
const PROFILE_DIR = join(ROOT, '.cache', 'showcase-profile')
const EXTENSIONS_DIR = join(ROOT, '.cache', 'showcase-extensions')
const OUTPUT = join(ROOT, 'images', 'showcase.webp')
const FPS = 45
const MAX_STATIC_FRAME_SECONDS = 3
const CURSOR_SETTLE_MS = 300
const ACTION_HOLD_MS = 450
const QUICK_HOLD_MS = 180
const PROMPT = 'Summarize this extension in one sentence.'

const args = new Set(process.argv.slice(2))
const smoke = args.has('--smoke')
const setup = args.has('--setup')
const scmProbe = args.has('--scm-probe')
const keepTemp = args.has('--keep-temp')

if (args.has('--help')) {
  console.log(`Usage: pnpm showcase -- [--setup | --smoke | --scm-probe] [--keep-temp]

Records the Universal Chat Provider showcase as an animated WebP.

Options:
  --setup      Open the isolated profile for a one-time GitHub sign-in
  --smoke      Validate tools, account state, proxy config, and codecs only
  --scm-probe  Capture Source Control commit-message controls only
  --keep-temp  Preserve temporary profiles, frames, and diagnostics

Environment:
  UCP_SHOWCASE_STORAGE  Existing extension storage containing config.yaml and auth/
`)
  process.exit(0)
}

async function main() {
  await Promise.all(['node', 'pnpm', 'code', 'git', 'ffmpeg', 'img2webp'].map(requireCommand))

  const storage = await findStorage()
  const configPath = join(storage, 'config.yaml')
  const config = parse(await readFile(configPath, 'utf8'))
  const port = positiveInteger(config?.port) ?? 8317
  const host = typeof config?.host === 'string' && config.host.trim() ? config.host.trim() : '127.0.0.1'
  const authFiles = (await readdir(join(storage, 'auth'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
  if (authFiles.length === 0)
    throw new Error(`No reusable account files found in ${join(storage, 'auth')}`)

  const binary = await findNewestBinary(join(storage, 'bin'))
  const environment = { storage, configPath, host, port, binary, accounts: authFiles.length }
  console.log(`Showcase preflight passed:
  output: ${OUTPUT}
  image: 1440x900 at ${FPS} fps, lossless animated WebP
  accounts: ${authFiles.length}
  proxy: http://${host}:${port}
  cached binary: ${binary}
  temp: ${TEMP_DIR}${keepTemp ? ' (preserved)' : ''}`)

  await runShowcase(environment)
}

async function runShowcase(environment) {
  await rm(TEMP_DIR, { recursive: true, force: true })
  const userDataDir = PROFILE_DIR
  const extensionsDir = EXTENSIONS_DIR
  const diagnosticsDir = join(TEMP_DIR, 'diagnostics')
  const demoDir = join(TEMP_DIR, 'workspace')
  await Promise.all([
    mkdir(join(userDataDir, 'User'), { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(diagnosticsDir, { recursive: true }),
    mkdir(demoDir, { recursive: true }),
  ])
  await prepareDemoRepository(demoDir)
  await seedManagedStorage(environment, userDataDir)
  await rm(join(userDataDir, 'User', 'chatLanguageModels.json'), { force: true })
  await writeFile(join(userDataDir, 'User', 'settings.json'), JSON.stringify(showcaseSettings(environment), null, 2))

  const vsix = await packageExtension()
  installExtension(vsix, userDataDir, extensionsDir)
  const installed = listExtensions(userDataDir, extensionsDir)
  if (installed.length !== 1 || installed[0] !== 'maxdewald.universal-chat-provider')
    throw new Error(`Unexpected isolated extension list: ${installed.join(', ') || '(empty)'}`)

  const port = await availablePort()
  const code = spawn('/usr/share/code/code', [
    demoDir,
    '--new-window',
    '--sync=off',
    '--skip-add-to-recently-opened',
    '--locale=en-US',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${port}`,
    '--start-maximized',
    '--disable-workspace-trust',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const stderr = []
  code.stderr.on('data', chunk => stderr.push(chunk))

  if (setup) {
    console.log('Isolated showcase profile opened with Settings Sync disabled. Sign in to GitHub Copilot, then close the window.')
    await new Promise(resolveExit => code.once('exit', resolveExit))
    return
  }

  let cdp
  try {
    const target = await waitForWorkbench(port)
    cdp = new CdpClient(target.webSocketDebuggerUrl)
    await cdp.connect()
    await waitFor(async () => Boolean(await cdp.evaluate('document.querySelector(".monaco-workbench")')), 20_000, 'VS Code workbench')
    const viewport = await cdp.evaluate('({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio })')
    const captureWidth = Math.round(viewport.width * viewport.scale)
    const captureHeight = Math.round(viewport.height * viewport.scale)
    console.log(`VS Code capture: ${captureWidth}x${captureHeight} from ${viewport.width}x${viewport.height} logical pixels at ${viewport.scale}x scale`)
    await writeFile(join(diagnosticsDir, 'viewport.json'), JSON.stringify({ ...viewport, captureWidth, captureHeight }, null, 2))
    await waitFor(() => cdp.isVisible('.model-picker-split .model-picker-section'), 20_000, 'chat model picker')
    await prepareWorkbench(cdp)
    await cdp.installCursor()
    await capturePng(cdp, join(diagnosticsDir, 'smoke.png'))
    const html = await cdp.evaluate('document.documentElement.outerHTML')
    await writeFile(join(diagnosticsDir, 'workbench.html'), html)
    console.log(`Isolated VS Code smoke capture passed: ${join(diagnosticsDir, 'smoke.png')}`)

    if (scmProbe) {
      await cdp.openSourceControl()
      await waitFor(() => cdp.hasVisibleAria('Generate Commit Message'), 10_000, 'Generate Commit Message control')
      await capturePng(cdp, join(diagnosticsDir, 'scm-probe.png'))
      await writeFile(join(diagnosticsDir, 'scm-probe.html'), await cdp.evaluate('document.documentElement.outerHTML'))
      console.log(`Source Control probe captured: ${join(diagnosticsDir, 'scm-probe.png')}`)
      return
    }

    if (!smoke) {
      await prepareSolMedium(cdp)
      await selectInitialModel(cdp)
      await clearChatInput(cdp)
      const framesDir = join(TEMP_DIR, 'frames')
      const stopRecording = await cdp.startRecording(framesDir)

      // Scene 1: management menu — open Add Account to show the provider list, then back out (already logged in).
      await cdp.showCaption(
        'ACCOUNTS',
        'Connect your subscriptions',
        'Sign in with OAuth to bring Claude, Codex, Gemini, Grok, and more into VS Code.',
      )
      await cdp.moveAndClickSelector('#maxdewald\\.universal-chat-provider .statusbar-item-label')
      await waitFor(() => cdp.hasVisibleAria('Add Account (Login)'), 5000, 'management menu')
      await cdp.sweepAria('Add Account (Login)')
      await cdp.moveAndClickAria('Add Account (Login)')
      await waitFor(() => cdp.hasVisibleAria('OpenAI Codex'), 5000, 'account provider list')
      await cdp.sweepAria('OpenAI Codex')
      await cdp.press('Escape')
      await waitFor(async () => !(await cdp.hasVisibleAria('OpenAI Codex')), 5000, 'account provider list to close')
      await cdp.press('Escape')
      await cdp.hoverSelector('.interactive-session')
      await visualPause(ACTION_HOLD_MS)

      // Scene 2: pick GPT 5.6 Sol from the full model list and raise its effort to High.
      await cdp.showCaption(
        'MODELS',
        'Choose any model',
        'Pick models directly in Copilot Chat and tune reasoning for each request.',
      )
      await cdp.moveAndClickSelector('.model-picker-split .model-picker-section')
      await waitFor(() => cdp.hasVisibleExactAria('Other Models'), 5000, 'Other Models picker entry')
      await cdp.quickMoveAndClickAria('Other Models', true)
      await waitFor(() => cdp.isVisible('.chat-model-picker-filter-input'), 5000, 'full model list')
      await cdp.quickScrollListToAria('GPT 5.6 Sol,')
      await cdp.quickMoveAndClickAria('GPT 5.6 Sol,')
      await waitFor(() => cdp.isVisible('.model-picker-config'), 5000, 'model configuration button')
      await waitFor(() => cdp.hasAttribute('.model-picker-config', 'aria-label', 'Thinking Effort: Medium'), 5000, 'initial Medium thinking effort')
      await cdp.quickMoveAndClickSelector('.model-picker-config')
      await waitFor(() => cdp.hasVisibleExactAria('High'), 5000, 'High thinking effort')
      await cdp.quickMoveAndClickAria('High', true)
      await waitFor(() => cdp.hasAttribute('.model-picker-config', 'aria-label', 'Thinking Effort: High'), 5000, 'High thinking effort selection')
      await cdp.press('Escape')
      await waitFor(async () => !(await cdp.hasVisibleExactAria('High')), 5000, 'recorded thinking effort menu to close')
      await waitFor(() => cdp.isVisible('.interactive-input-editor .native-edit-context'), 5000, 'chat input')
      await cdp.quickMoveAndClickSelector('.interactive-input-editor .native-edit-context')
      await cdp.insertText('.interactive-input-editor .native-edit-context', PROMPT)
      await waitFor(async () => await cdp.chatInputText() === PROMPT, 5000, 'complete chat prompt')
      await waitFor(() => cdp.isAriaEnabled('Send'), 5000, 'chat send button')
      const responseCount = await cdp.chatResponseCount()
      await cdp.quickMoveAndClickAria('Send')
      await waitFor(async () => await cdp.chatResponseCount() > responseCount, 20_000, 'chat response')
      await cdp.showCaption(
        'QUOTA',
        'Usage at a glance',
        'Check live quota across every connected account before you hit a limit.',
      )
      for (let sweep = 0; sweep < 2; sweep++)
        await cdp.sweepSelector('#maxdewald\\.universal-chat-provider .statusbar-item-label')
      await waitFor(() => cdp.hasVisibleSelectorText('.monaco-hover-content', 'Quota'), 5000, 'quota tooltip')
      await visualPause(1500)
      await cdp.showCaption(
        'UTILITY MODEL',
        'One model, more workflows',
        'Use your models for commit messages, chat titles, and summaries too.',
      )
      await cdp.moveAndClickSelector('#maxdewald\\.universal-chat-provider .statusbar-item-label')
      await waitFor(() => cdp.hasVisibleAria('Set Utility Model,'), 5000, 'management menu')
      await cdp.sweepAria('Set Utility Model,')
      await cdp.moveAndClickAria('Set Utility Model,')
      await waitFor(() => cdp.isVisible('.quick-input-widget .monaco-list'), 5000, 'utility model picker')
      for (let attempt = 0; attempt < 3; attempt++) {
        await cdp.quickScrollAndClickQuickInputAria('gemini-3.5-flash-extra-low')
        if (await waitForOptional(() => cdp.hasVisibleSelectorText('.quick-input-title', 'Set Utility Thinking Effort'), 1500))
          break
      }
      if (!(await cdp.hasVisibleSelectorText('.quick-input-title', 'Set Utility Thinking Effort')))
        throw new Error('Could not open Gemini 3.5 Flash Extra Low utility reasoning picker')
      await waitFor(() => cdp.hasVisibleExactAria('Low, low'), 5000, 'utility model reasoning picker')
      await cdp.quickMoveAndClickAria('Low, low', true)
      await waitFor(async () => !(await cdp.hasVisibleSelectorText('.quick-input-title', 'Set Utility Thinking Effort')), 5000, 'utility model reasoning picker to close')
      await waitFor(() => cdp.hasVisibleSelectorText('.notification-list-item', 'gemini-3.5-flash-extra-low (Low)'), 5000, 'Gemini 3.5 Flash Extra Low confirmation')

      // Scene 3: prove the utility model by generating a commit message for the staged demo change.
      await cdp.openSourceControl()
      await waitFor(() => cdp.hasVisibleAria('Generate Commit Message'), 5000, 'Generate Commit Message control')
      await cdp.showCaption(
        'SOURCE CONTROL',
        'Commit messages, generated',
        'Copilot writes from the staged change using Gemini 3.5 Flash Extra Low.',
      )
      await cdp.sweepAria('Generate Commit Message')
      await cdp.moveAndClickAria('Generate Commit Message')
      await waitFor(async () => (await cdp.scmInputText()).trim().length > 0, 30_000, 'generated commit message')
      await visualPause(1800)
      const records = await stopRecording()
      const concatPath = await writeFrameTimeline(framesDir, records)
      await encodeWebp(concatPath, OUTPUT)
      console.log(`Showcase recorded: ${OUTPUT}`)
      console.log(`Selector diagnostics captured in ${diagnosticsDir}`)
    }
  }
  catch (error) {
    if (cdp !== undefined) {
      await capturePng(cdp, join(diagnosticsDir, 'failure.png')).catch(() => {})
      const html = await cdp.evaluate('document.documentElement.outerHTML').catch(() => '')
      if (html)
        await writeFile(join(diagnosticsDir, 'failure.html'), html)
    }
    if (stderr.length > 0)
      await writeFile(join(diagnosticsDir, 'vscode-stderr.log'), Buffer.concat(stderr).toString())
    throw error
  }
  finally {
    cdp?.close()
    code.kill('SIGTERM')
    await waitForExit(code, 5000)
    if (!keepTemp && !smoke)
      await rm(TEMP_DIR, { recursive: true, force: true })
  }
}

async function seedManagedStorage(environment, userDataDir) {
  const target = join(userDataDir, 'User', 'globalStorage', 'maxdewald.universal-chat-provider')
  await rm(target, { recursive: true, force: true })
  await Promise.all([
    cp(join(environment.storage, 'auth'), join(target, 'auth'), { recursive: true }),
    cp(dirname(environment.binary), join(target, 'bin', basename(dirname(environment.binary))), { recursive: true }),
  ])
}

async function prepareDemoRepository(demoDir) {
  const readme = join(demoDir, 'README.md')
  await writeFile(readme, '# Universal Chat Provider\n\nUse subscription models directly in Copilot Chat.\n')
  runIn(demoDir, 'git', ['init', '-b', 'main'])
  runIn(demoDir, 'git', ['config', 'user.name', 'Showcase'])
  runIn(demoDir, 'git', ['config', 'user.email', 'showcase@example.invalid'])
  runIn(demoDir, 'git', ['add', 'README.md'])
  runIn(demoDir, 'git', ['commit', '-m', 'docs: add project overview'])
  await writeFile(readme, '# Universal Chat Provider\n\nUse subscription models directly in Copilot Chat.\n\nNo API keys required.\n')
  runIn(demoDir, 'git', ['add', 'README.md'])
}

async function prepareWorkbench(cdp) {
  const importAvailable = await waitForOptional(() => cdp.hasVisibleText('Import API Key'), 10_000)
  if (importAvailable) {
    await cdp.clickText('Import API Key')
    await waitFor(async () => !(await cdp.hasVisibleText('Import API Key')), 20_000, 'CLIProxyAPI key import')
    await waitFor(() => cdp.isVisible('.model-picker-split .model-picker-section'), 20_000, 'chat model picker after API key import')
  }
  if (await cdp.hasVisibleText('Choose Model'))
    await cdp.press('Escape')
  if (await cdp.hasVisibleAria('Restore Secondary Side Bar')) {
    await cdp.clickAria('Restore Secondary Side Bar')
    await waitFor(() => cdp.hasMaximumWidth('#workbench\\.parts\\.auxiliarybar', 500), 5000, 'Chat to restore to sidebar width')
  }
  if (await cdp.isVisible('#workbench\\.parts\\.sidebar')) {
    await cdp.clickAria('Toggle Primary Side Bar')
    await waitFor(async () => !(await cdp.isVisible('#workbench\\.parts\\.sidebar')), 5000, 'primary side bar to close')
  }
  if (await cdp.isVisible('#workbench\\.parts\\.panel')) {
    await cdp.clickAria('Hide Panel')
    await waitFor(async () => !(await cdp.isVisible('#workbench\\.parts\\.panel')), 5000, 'panel to close')
  }
}

async function selectInitialModel(cdp) {
  if (await cdp.hasText('.model-picker-name', 'GPT 5.5'))
    return
  await closeThinkingEffortMenu(cdp)
  for (let attempt = 0; attempt < 3; attempt++) {
    await cdp.fastClickSelector('.model-picker-name')
    if (await waitForOptional(async () => await cdp.hasVisibleAria('GPT 5.5,') || await cdp.hasVisibleExactAria('Other Models'), 1000))
      break
    await closeThinkingEffortMenu(cdp)
  }
  if (!(await cdp.hasVisibleAria('GPT 5.5,')) && !(await cdp.hasVisibleExactAria('Other Models')))
    throw new Error('Could not open GPT 5.5 or Other Models during preparation')
  if (await cdp.hasVisibleAria('GPT 5.5,')) {
    await cdp.fastClickAria('GPT 5.5,')
  }
  else {
    await cdp.fastClickAria('Other Models', true)
    await waitFor(() => cdp.isVisible('.chat-model-picker-filter-input'), 5000, 'full model list')
    await cdp.fastScrollListToAria('GPT 5.5,')
    await cdp.fastClickAria('GPT 5.5,')
  }
  await waitFor(() => cdp.hasText('.model-picker-name', 'GPT 5.5'), 5000, 'GPT 5.5 selection')
}

async function prepareSolMedium(cdp) {
  await cdp.fastClickSelector('.model-picker-name')
  await waitFor(() => cdp.hasVisibleExactAria('Other Models'), 5000, 'Other Models picker entry')
  await cdp.fastClickAria('Other Models', true)
  await waitFor(() => cdp.isVisible('.chat-model-picker-filter-input'), 5000, 'full model list')
  await cdp.fastScrollListToAria('GPT 5.6 Sol,')
  await cdp.fastClickAria('GPT 5.6 Sol,')
  await waitFor(() => cdp.isVisible('.model-picker-config'), 5000, 'model configuration button')
  await waitFor(() => cdp.hasText('.model-picker-name', 'GPT 5.6 Sol'), 5000, 'Sol model selection')
  await waitFor(async () => !(await cdp.isVisible('.chat-model-picker-filter-input')), 5000, 'model list to close')
  for (let attempt = 0; attempt < 3 && !(await cdp.hasVisibleExactAria('Medium')); attempt++) {
    await cdp.fastClickSelector('.model-picker-config')
    await waitForOptional(() => cdp.hasVisibleExactAria('Medium'), 1000)
  }
  if (!(await cdp.hasVisibleExactAria('Medium')))
    throw new Error('Could not open Medium thinking effort during preparation')
  await cdp.fastClickAria('Medium', true)
  await waitFor(() => cdp.hasAttribute('.model-picker-config', 'aria-label', 'Thinking Effort: Medium'), 5000, 'Medium thinking effort preparation')
  await closeThinkingEffortMenu(cdp)
}

async function closeThinkingEffortMenu(cdp) {
  for (let attempt = 0; attempt < 3 && await cdp.hasVisibleExactAria('High'); attempt++) {
    await cdp.press('Escape')
    await waitForOptional(async () => !(await cdp.hasVisibleExactAria('High')), 1000)
  }
  if (await cdp.hasVisibleExactAria('High'))
    throw new Error('Could not close thinking effort menu during preparation')
  await waitFor(async () => !(await cdp.hasVisibleExactAria('Medium')) && !(await cdp.hasVisibleExactAria('Extra High')), 5000, 'all thinking effort options to disappear')
}

async function clearChatInput(cdp) {
  const selector = '.interactive-input-editor .native-edit-context'
  await waitFor(() => cdp.isVisible(selector), 5000, 'chat input before recording')
  for (let attempt = 0; attempt < 3; attempt++) {
    await cdp.fastClickSelector(selector)
    await cdp.selectAllAndDelete()
    if (await waitForOptional(async () => (await cdp.chatInputText()).trim() === '' && !(await cdp.isAriaEnabled('Send')), 1500))
      return
  }
  throw new Error(`Could not clear chat input before recording: ${JSON.stringify(await cdp.chatInputText())}`)
}

function showcaseSettings(environment) {
  return {
    'workbench.colorTheme': 'Dark Modern',
    'workbench.startupEditor': 'none',
    'workbench.welcomePage.walkthroughs.openOnInstall': false,
    'workbench.editor.enablePreview': false,
    'workbench.activityBar.location': 'top',
    'window.commandCenter': false,
    'window.titleBarStyle': 'custom',
    'window.zoomLevel': 0,
    'editor.fontSize': 17,
    'editor.minimap.enabled': false,
    'editor.stickyScroll.enabled': false,
    'chat.fontSize': 16,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'security.workspace.trust.enabled': false,
    'universalChatProvider.server.mode': 'managed',
    'universalChatProvider.configPath': '',
    'universalChatProvider.autoDetectConfig': false,
    'universalChatProvider.server.updatePolicy': 'manual',
    'universalChatProvider.server.version': basename(dirname(environment.binary)),
  }
}

async function packageExtension() {
  run('pnpm', ['ext:package'])
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const filename = `universal-chat-provider-${version}.vsix`
  const path = join(ROOT, filename)
  if (spawnSync('test', ['-f', path]).status !== 0)
    throw new Error(`Packaged VSIX not found: ${path}`)
  return path
}

function installExtension(vsix, userDataDir, extensionsDir) {
  run('code', [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--sync=off',
    '--install-extension',
    vsix,
    '--force',
  ])
}

function listExtensions(userDataDir, extensionsDir) {
  return spawnSync('code', [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--sync=off',
    '--list-extensions',
  ], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).sort()
}

function run(command, args) {
  runIn(ROOT, command, args)
}

function runIn(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : undefined
      server.close(error => error === undefined && port !== undefined ? resolvePort(port) : reject(error ?? new Error('No port assigned')))
    })
  })
}

async function waitForWorkbench(port) {
  let targets = []
  await waitFor(async () => {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => [])
    return targets.some(target => target.type === 'page' && target.webSocketDebuggerUrl)
  }, 30_000, 'VS Code debug target')
  return targets.find(target => target.type === 'page' && target.url.includes('workbench'))
    ?? targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
}

async function waitForExit(child, timeout) {
  if (child.exitCode !== null)
    return
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, timeout)),
  ])
  if (child.exitCode === null)
    child.kill('SIGKILL')
}

async function waitFor(check, timeout, description) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check())
      return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function waitForOptional(check, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check())
      return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

function visualPause(duration) {
  return new Promise(resolve => setTimeout(resolve, duration))
}

async function capturePng(cdp, path) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path, Buffer.from(data, 'base64'))
}

async function writeFrameTimeline(framesDir, frameRecords) {
  if (frameRecords.length < 2)
    throw new Error('Not enough screencast frames were captured.')

  const concatPath = join(framesDir, 'frames.ffconcat')
  const lines = ['ffconcat version 1.0']
  for (let index = 0; index < frameRecords.length - 1; index++) {
    const current = frameRecords[index]
    const next = frameRecords[index + 1]
    lines.push(`file '${current.filename}'`)
    lines.push(`duration ${Math.min(MAX_STATIC_FRAME_SECONDS, Math.max(1 / 120, next.timestamp - current.timestamp)).toFixed(6)}`)
  }
  lines.push(`file '${frameRecords.at(-1).filename}'`)
  await writeFile(concatPath, `${lines.join('\n')}\n`)
  return concatPath
}

async function encodeWebp(concatPath, output) {
  const framesDir = join(TEMP_DIR, 'webp-frames')
  await rm(framesDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'warning',
    '-safe',
    '0',
    '-f',
    'concat',
    '-i',
    concatPath,
    '-vf',
    `fps=${FPS},scale=1440:900:flags=lanczos`,
    join(framesDir, 'frame-%06d.png'),
  ])

  const frames = (await readdir(framesDir))
    .filter(filename => filename.endsWith('.png'))
    .sort()
  const temporaryOutput = `${output}.tmp.webp`
  const args = ['-loop', '0', '-min_size']
  for (let index = 0; index < frames.length; index++) {
    const duration = Math.round((index + 1) * 1000 / FPS) - Math.round(index * 1000 / FPS)
    args.push(
      '-d',
      String(duration),
      '-lossless',
      '-q',
      '95',
      '-m',
      '6',
      '-exact',
      join(framesDir, frames[index]),
    )
  }
  args.push('-o', temporaryOutput)
  run('img2webp', args)
  await rename(temporaryOutput, output)
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) {
        for (const listener of this.listeners.get(message.method) ?? [])
          listener(message.params)
        return
      }
      const pending = this.pending.get(message.id)
      if (pending === undefined)
        return
      this.pending.delete(message.id)
      if (message.error !== undefined)
        pending.reject(new Error(message.error.message))
      else
        pending.resolve(message.result)
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable')])
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolveResult, reject) => {
      this.pending.set(id, { resolve: resolveResult, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined)
      throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  async clickAria(label) {
    const clicked = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll('[aria-label]')]
        .find(candidate => candidate.getAttribute('aria-label')?.includes(${JSON.stringify(label)}) && candidate.getClientRects().length > 0)
      if (!element) return false
      element.click()
      return true
    })()`)
    if (!clicked)
      throw new Error(`Could not find visible aria-label containing ${label}`)
  }

  async clickText(text) {
    const clicked = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll('a, button, [role="button"]')]
        .find(candidate => candidate.textContent?.trim().includes(${JSON.stringify(text)}) && candidate.getClientRects().length > 0)
      if (!element) return false
      element.click()
      return true
    })()`)
    if (!clicked)
      throw new Error(`Could not find visible control containing ${text}`)
  }

  async hoverSelector(selector) {
    const point = await this.elementCenter(selector)
    await this.moveCursor(point.x, point.y)
  }

  async sweepSelector(selector) {
    const bounds = await this.elementBounds(selector)
    await this.moveCursor(bounds.left + bounds.width * 0.3, bounds.top + bounds.height * 0.5)
    await this.moveCursor(bounds.left + bounds.width * 0.7, bounds.top + bounds.height * 0.5)
  }

  async sweepAria(label, exact = false) {
    const bounds = await this.ariaBounds(label, exact)
    await this.moveCursor(bounds.left + bounds.width * 0.3, bounds.top + bounds.height * 0.5)
    await this.moveCursor(bounds.left + bounds.width * 0.7, bounds.top + bounds.height * 0.5)
  }

  async moveMouse(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  }

  async installCursor() {
    await this.evaluate(`(() => {
      if (document.getElementById('ucp-showcase-cursor')) return
      const style = document.createElement('style')
      style.id = 'ucp-showcase-cursor-style'
      style.textContent = \`
        #ucp-showcase-cursor {
          position: fixed;
          z-index: 2147483647;
          width: 24px;
          height: 32px;
          left: 0;
          top: 0;
          pointer-events: none;
          transform: translate3d(48px, 48px, 0);
          transition: transform .7s cubic-bezier(.45, 0, .25, 1);
          will-change: transform;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .9));
        }
        #ucp-showcase-cursor::before {
          content: '';
          display: block;
          width: 100%;
          height: 100%;
          background: #ffffff;
          clip-path: polygon(0 0, 0 86%, 21% 67%, 35% 100%, 51% 92%, 37% 61%, 68% 61%);
        }
        #ucp-showcase-cursor::after {
          content: '';
          position: absolute;
          width: 34px;
          height: 34px;
          left: -17px;
          top: -17px;
          border: 3px solid #58a6ff;
          border-radius: 50%;
          opacity: 0;
          transform: scale(.25);
        }
        #ucp-showcase-cursor.clicking::after {
          animation: ucp-showcase-click 420ms ease-out;
        }
        #ucp-showcase-caption {
          position: fixed;
          z-index: 2147483646;
          box-sizing: border-box;
          width: 360px;
          padding: 18px 20px 20px;
          color: #f0f0f0;
          background: rgba(24, 24, 24, .94);
          border: 1px solid rgba(255, 255, 255, .14);
          border-left: 3px solid #4ec9b0;
          border-radius: 6px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, .34);
          backdrop-filter: blur(12px);
          opacity: 0;
          transform: translate3d(0, 12px, 0);
          transition: opacity 240ms ease, transform 280ms cubic-bezier(.2, .8, .2, 1);
          pointer-events: none;
        }
        #ucp-showcase-caption.visible {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        #ucp-showcase-caption .eyebrow {
          margin-bottom: 8px;
          color: #4ec9b0;
          font: 650 11px/1.2 system-ui, sans-serif;
          letter-spacing: 0;
        }
        #ucp-showcase-caption .title {
          color: #ffffff;
          font: 600 23px/1.18 system-ui, sans-serif;
          letter-spacing: 0;
        }
        #ucp-showcase-caption .detail {
          margin-top: 8px;
          color: #c8c8c8;
          font: 400 14px/1.45 system-ui, sans-serif;
          letter-spacing: 0;
        }
        @keyframes ucp-showcase-click {
          0% { opacity: .95; transform: scale(.25); }
          100% { opacity: 0; transform: scale(1.25); }
        }
      \`
      document.head.append(style)
      const cursor = document.createElement('div')
      cursor.id = 'ucp-showcase-cursor'
      document.body.append(cursor)
      const caption = document.createElement('div')
      caption.id = 'ucp-showcase-caption'
      for (const className of ['eyebrow', 'title', 'detail']) {
        const line = document.createElement('div')
        line.className = className
        caption.append(line)
      }
      document.body.append(caption)
      window.__ucpShowcaseCursor = { x: 48, y: 48 }
    })()`)
    await this.moveMouse(48, 48)
  }

  async showCaption(eyebrow, title, detail) {
    await this.evaluate(`new Promise((resolve) => {
      const caption = document.getElementById('ucp-showcase-caption')
      const editor = document.getElementById('workbench.parts.editor')
      const rect = editor?.getBoundingClientRect()
      caption.classList.remove('visible')
      caption.querySelector('.eyebrow').textContent = ${JSON.stringify(eyebrow)}
      caption.querySelector('.title').textContent = ${JSON.stringify(title)}
      caption.querySelector('.detail').textContent = ${JSON.stringify(detail)}
      caption.style.left = Math.max(32, (rect?.left ?? 0) + 48) + 'px'
      caption.style.top = Math.max(88, (rect?.top ?? 0) + 64) + 'px'
      requestAnimationFrame(() => requestAnimationFrame(() => caption.classList.add('visible')))
      setTimeout(resolve, 300)
    })`)
  }

  async moveCursor(x, y, duration = 700) {
    await this.evaluate(`new Promise((resolve) => {
      const cursor = document.getElementById('ucp-showcase-cursor')
      cursor.addEventListener('transitionend', resolve, { once: true })
      setTimeout(resolve, ${Number(duration) + 100})
      cursor.style.transitionDuration = '${Number(duration)}ms'
      cursor.style.transform = 'translate3d(${Number(x)}px, ${Number(y)}px, 0)'
    })`)
    await this.moveMouse(x, y)
  }

  async clickAt(x, y) {
    await this.evaluate(`(() => {
      const cursor = document.getElementById('ucp-showcase-cursor')
      cursor.classList.remove('clicking')
      void cursor.offsetWidth
      cursor.classList.add('clicking')
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await new Promise(resolve => setTimeout(resolve, 90))
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  async fastClickSelector(selector) {
    await this.fastClick(await this.elementCenter(selector))
  }

  async fastClickAria(label, exact = false) {
    await this.fastClick(await this.ariaCenter(label, exact))
  }

  async fastClick(point) {
    await this.moveMouse(point.x, point.y)
    await this.clickAt(point.x, point.y)
  }

  async moveAndClickSelector(selector) {
    await this.moveAndClick(await this.elementCenter(selector))
  }

  async moveAndClickAria(label, exact = false) {
    await this.moveAndClick(await this.ariaCenter(label, exact))
  }

  async moveAndClick(point) {
    await this.moveCursor(point.x, point.y)
    await visualPause(CURSOR_SETTLE_MS)
    await this.clickAt(point.x, point.y)
    await visualPause(ACTION_HOLD_MS)
  }

  async quickMoveAndClickSelector(selector) {
    await this.quickMoveAndClick(await this.elementCenter(selector))
  }

  async quickMoveAndClickAria(label, exact = false) {
    await this.quickMoveAndClick(await this.ariaCenter(label, exact))
  }

  async quickMoveAndClick(point) {
    await this.moveCursor(point.x, point.y, 350)
    await this.clickAt(point.x, point.y)
    await visualPause(QUICK_HOLD_MS)
  }

  async ariaCenter(label, exact = false) {
    const bounds = await this.ariaBounds(label, exact)
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }

  async ariaBounds(label, exact = false) {
    const bounds = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll('[aria-label]')]
        .find(candidate => ${exact ? `candidate.getAttribute('aria-label') === ${JSON.stringify(label)}` : `candidate.getAttribute('aria-label')?.includes(${JSON.stringify(label)})`}
          && candidate.getClientRects().length > 0)
      if (!element) return undefined
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })()`)
    if (bounds === undefined)
      throw new Error(`Could not find visible aria-label containing ${label}`)
    return bounds
  }

  async fastScrollListToAria(label) {
    await this.scrollModelListToAria(label, 80)
  }

  async quickScrollListToAria(label) {
    const point = await this.visibleActionListCenter()
    await this.moveCursor(point.x, point.y, 350)
    await this.scrollModelListToAria(label, 70, 12, point)
  }

  async scrollModelListToAria(label, deltaY, pause = 0, point = undefined) {
    point ??= await this.visibleActionListCenter()
    for (let step = 0; step < 120; step++) {
      if (await this.hasVisibleAria(label))
        return
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaY, deltaX: 0 })
      if (pause > 0)
        await visualPause(pause)
    }
    throw new Error(`Could not find ${label} while scrolling the model list`)
  }

  async quickScrollAndClickQuickInputAria(label, exact = false) {
    for (let step = 0; step < 160; step++) {
      const state = await this.quickInputAriaPosition(label, exact)
      if (state === undefined)
        throw new Error('Could not find the visible utility model list')
      if (state.target !== undefined && Math.abs(state.target.y - state.list.y) <= 24) {
        await this.moveCursor(state.target.x, state.target.y, 350)
        await visualPause(180)
        const settled = await this.quickInputAriaPosition(label, exact)
        if (settled?.target === undefined || Math.abs(settled.target.y - settled.list.y) > 32)
          continue
        await this.clickAt(settled.target.x, settled.target.y)
        await visualPause(QUICK_HOLD_MS)
        return
      }
      const deltaY = state.target === undefined ? 48 : Math.max(-48, Math.min(48, state.target.y - state.list.y))
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: state.list.x, y: state.list.y, deltaY, deltaX: 0 })
      await visualPause(18)
    }
    throw new Error(`Could not find ${label} while scrolling the utility model list`)
  }

  async quickInputAriaPosition(label, exact = false) {
    return this.evaluate(`(() => {
      const widget = [...document.querySelectorAll('.quick-input-widget')]
        .find(candidate => candidate.getClientRects().length > 0)
      const list = widget?.querySelector('.monaco-list')
      if (!list || list.getClientRects().length === 0) return undefined
      const listRect = list.getBoundingClientRect()
      const element = [...widget.querySelectorAll('[aria-label]')]
        .find(candidate => ${exact ? `candidate.getAttribute('aria-label') === ${JSON.stringify(label)}` : `candidate.getAttribute('aria-label')?.includes(${JSON.stringify(label)})`}
          && candidate.getClientRects().length > 0)
      if (!element)
        return { list: { x: listRect.left + listRect.width / 2, y: listRect.top + listRect.height / 2 } }
      const rect = element.getBoundingClientRect()
      return {
        list: { x: listRect.left + listRect.width / 2, y: listRect.top + listRect.height / 2 },
        target: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      }
    })()`)
  }

  async visibleActionListCenter() {
    const point = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll('.context-view:not([aria-hidden="true"]) .actionList')]
        .findLast(candidate => candidate.getClientRects().length > 0)
      if (!element) return undefined
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
    if (point === undefined)
      throw new Error('Could not find the visible full model list')
    return point
  }

  async startRecording(framesDir) {
    await mkdir(framesDir, { recursive: true })
    const records = []
    let frameIndex = 0
    let writeChain = Promise.resolve()
    let resolveFirstFrame
    const firstFrame = new Promise(resolve => resolveFirstFrame = resolve)
    const removeListener = this.on('Page.screencastFrame', (frame) => {
      const filename = `frame-${String(frameIndex++).padStart(6, '0')}.png`
      records.push({ filename, timestamp: frame.metadata.timestamp })
      writeChain = writeChain.then(() => writeFile(join(framesDir, filename), Buffer.from(frame.data, 'base64')))
      void this.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      resolveFirstFrame()
    })
    await this.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await firstFrame
    return async () => {
      await this.send('Page.stopScreencast')
      removeListener()
      await writeChain
      return records
    }
  }

  async elementCenter(selector) {
    const bounds = await this.elementBounds(selector)
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }

  async elementBounds(selector) {
    const bounds = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(candidate => candidate.getClientRects().length > 0)
      if (!element) return undefined
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })()`)
    if (bounds === undefined)
      throw new Error(`Could not find visible selector ${selector}`)
    return bounds
  }

  hasVisibleText(text) {
    return this.evaluate(`[...document.querySelectorAll('a, button, [role="button"]')]
      .some(candidate => candidate.textContent?.trim().includes(${JSON.stringify(text)}) && candidate.getClientRects().length > 0)`)
  }

  hasVisibleAria(label) {
    return this.evaluate(`[...document.querySelectorAll('[aria-label]')]
      .some(candidate => candidate.getAttribute('aria-label')?.includes(${JSON.stringify(label)}) && candidate.getClientRects().length > 0)`)
  }

  hasVisibleExactAria(label) {
    return this.evaluate(`[...document.querySelectorAll('[aria-label]')]
      .some(candidate => candidate.getAttribute('aria-label') === ${JSON.stringify(label)} && candidate.getClientRects().length > 0)`)
  }

  hasVisibleSelectorText(selector, text) {
    return this.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})]
      .some(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(text)}))`)
  }

  isVisible(selector) {
    return this.evaluate(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(candidate => candidate.getClientRects().length > 0))`)
  }

  hasAttribute(selector, name, value) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) === ${JSON.stringify(value)}`)
  }

  hasText(selector, text) {
    return this.evaluate(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.replace(/\\u00a0/g, ' ').trim() === ${JSON.stringify(text)}))`)
  }

  hasMaximumWidth(selector, width) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width <= ${Number(width)}`)
  }

  isAriaEnabled(label) {
    return this.evaluate(`Boolean([...document.querySelectorAll('[aria-label]')]
      .find(candidate => candidate.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)})
        && candidate.getClientRects().length > 0
        && candidate.getAttribute('aria-disabled') !== 'true'))`)
  }

  chatInputText() {
    return this.evaluate(`(() => {
      const editor = [...document.querySelectorAll('.interactive-input-editor .monaco-editor')]
        .find(candidate => candidate.getClientRects().length > 0)
      return editor?.querySelector('.view-lines')?.textContent?.replace(/\\u00a0/g, ' ') ?? ''
    })()`)
  }

  scmInputText() {
    return this.evaluate(`(() => {
      const editor = [...document.querySelectorAll('.scm-editor .monaco-editor')]
        .find(candidate => candidate.getClientRects().length > 0)
      return editor?.querySelector('.view-lines')?.textContent?.replace(/\\u00a0/g, ' ') ?? ''
    })()`)
  }

  chatResponseCount() {
    return this.evaluate('document.querySelectorAll(".interactive-response, .chat-response-view").length')
  }

  async insertText(selector, text) {
    const focused = await this.evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(candidate => candidate.getClientRects().length > 0)
      if (!element) return false
      element.focus()
      return document.activeElement === element
    })()`)
    if (!focused)
      throw new Error(`Could not focus selector ${selector}`)
    await this.send('Input.insertText', { text })
  }

  async selectAllAndDelete() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft' })
    await this.press('Backspace')
  }

  async openSourceControl() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 10 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'g', code: 'KeyG', modifiers: 10 })
  }

  async press(key) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
  }

  close() {
    this.socket?.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

async function findStorage() {
  const candidates = [
    process.env.UCP_SHOWCASE_STORAGE,
    join(homedir(), '.config', 'Code', 'User', 'globalStorage', 'maxdewald.universal-chat-provider'),
    join(homedir(), '.config', 'Code - Insiders', 'User', 'globalStorage', 'maxdewald.universal-chat-provider'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await exists(join(candidate, 'config.yaml')) && await exists(join(candidate, 'auth')))
      return candidate
  }
  throw new Error('Could not find existing Universal Chat Provider storage. Set UCP_SHOWCASE_STORAGE.')
}

async function findNewestBinary(binDir) {
  const versions = (await readdir(binDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const version of versions) {
    const binary = join(binDir, version, process.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api')
    if (await exists(binary))
      return binary
  }
  throw new Error(`No cached CLIProxyAPI binary found in ${binDir}`)
}

async function requireCommand(command) {
  const executable = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(executable, [command], { stdio: 'ignore' })
  if (result.status !== 0)
    throw new Error(`Required command not found: ${command}`)
}

async function exists(path) {
  return access(path).then(() => true, () => false)
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}
