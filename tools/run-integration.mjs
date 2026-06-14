import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { runTests } from '@vscode/test-electron'
import { parse } from 'yaml'

async function main() {
  const root = resolve(import.meta.dirname, '..')
  const configPath = process.env.CLIPROXY_CONFIG ?? join(homedir(), 'cliproxyapi', 'config.yaml')
  const proxyBinary = process.env.CLIPROXY_BINARY ?? join(homedir(), 'cliproxyapi', 'cli-proxy-api')
  const config = parse(await readFile(configPath, 'utf8'))
  const apiKey = config['api-keys']?.find(value =>
    typeof value === 'string' && value.length > 0 && !/^your-api-key/i.test(value))
  if (apiKey === undefined)
    throw new Error(`No usable API key found in ${configPath}`)

  const port = Number(config.port ?? 8317)
  const baseUrl = `http://127.0.0.1:${port}`
  let proxy
  const temp = await mkdtemp(join(tmpdir(), 'modelprovider-integration-'))

  try {
    if (!await portOpen(port)) {
      proxy = spawn(proxyBinary, ['-config', configPath], {
        cwd: join(homedir(), 'cliproxyapi'),
        env: { ...process.env, HOME: homedir() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      await waitForPort(port, proxy)
    }

    await runTests({
      version: 'insiders',
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'test', 'integration', 'index.cjs'),
      launchArgs: [
        '--headless',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--ozone-platform=headless',
        '--enable-proposed-api=maxdewald.modelprovider',
        `--user-data-dir=${join(temp, 'user-data')}`,
        `--extensions-dir=${join(temp, 'extensions')}`,
      ],
      extensionTestsEnv: {
        MODEL_PROVIDER_TEST: '1',
        CLIPROXY_BASE_URL: baseUrl,
        CLIPROXY_API_KEY: apiKey,
      },
    })
  }
  finally {
    if (proxy !== undefined) {
      proxy.kill('SIGTERM')
      await Promise.race([
        new Promise(resolve => proxy.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ])
    }
    await rm(temp, { recursive: true, force: true })
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForPort(port, process) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (process.exitCode !== null)
      throw new Error(`CLIProxyAPI exited with code ${process.exitCode}`)
    if (await portOpen(port))
      return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`CLIProxyAPI did not start on port ${port}`)
}

void main()
