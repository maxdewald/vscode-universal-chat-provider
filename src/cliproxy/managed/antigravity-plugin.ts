import type { OutputChannel } from 'vscode'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import { Type } from '@sinclair/typebox'
import { normalizeVersion } from '@src/cliproxy/managed/binary'
import { githubFetch, installReleaseAsset } from '@src/cliproxy/managed/github-release'
import { asJsonValue } from '@src/shared/json'

const REPO = 'adeebahmad01/cliproxy-antigravity'
const SIGN_IN_WINDOW_MS = 20 * 60_000

const AuthFileSchema = Type.Object({
  type: Type.Optional(Type.String()),
  home: Type.Optional(Type.String()),
})

export function agyDirectories(root: string): { pluginDir: string, accountsDir: string, workdir: string } {
  return {
    pluginDir: join(root, 'plugins'),
    accountsDir: join(root, 'agy-accounts'),
    workdir: join(root, 'agy-workdir'),
  }
}

const versionFile = (root: string): string => join(agyDirectories(root).pluginDir, 'version')
const signInMarker = (root: string): string => join(agyDirectories(root).pluginDir, 'sign-in-pending')

export async function installAgyPlugin(root: string, output: OutputChannel, signal?: AbortSignal): Promise<void> {
  const { pluginDir, accountsDir, workdir } = agyDirectories(root)
  await mkdir(workdir, { recursive: true })
  await mkdir(accountsDir, { recursive: true, mode: 0o700 })
  const release = await githubFetch.get(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: signal ?? null }).json<{ tag_name: string }>()
  const version = normalizeVersion(release.tag_name)
  if (await readFile(versionFile(root), 'utf8').then(value => value.trim(), () => undefined) === version)
    return

  const assetName = `cliproxy-antigravity_${version}_${osPlatform() === 'win32' ? 'windows' : osPlatform()}_${osArch() === 'x64' ? 'amd64' : osArch()}.zip`
  output.appendLine(`Downloading the Antigravity plugin ${version} (${assetName})...`)
  await installReleaseAsset(REPO, version, assetName, pluginDir, signal)
  await writeFile(versionFile(root), version)
  output.appendLine(`Installed the Antigravity plugin ${version}.`)
}

export async function markAgySignIn(root: string, pending: boolean): Promise<void> {
  if (pending)
    await writeFile(signInMarker(root), '')
  else
    await rm(signInMarker(root), { force: true })
}

// The plugin runs while an agy account exists, or a sign-in needs it to create the first one.
export async function agyPluginConfig(root: string, authDir: string): Promise<Record<string, unknown> | undefined> {
  if (await readFile(versionFile(root), 'utf8').then(() => false, () => true))
    return undefined
  const { pluginDir, accountsDir, workdir } = agyDirectories(root)
  const signingIn = await stat(signInMarker(root)).then(info => Date.now() - info.mtimeMs < SIGN_IN_WINDOW_MS, () => false)
  return {
    enabled: true,
    dir: pluginDir,
    configs: {
      'cliproxy-antigravity': {
        enabled: signingIn || await hasAgyAccount(authDir),
        auth_dir: authDir,
        accounts_dir: accountsDir,
        workdir,
        sandbox: true,
      },
    },
  }
}

async function hasAgyAccount(authDir: string): Promise<boolean> {
  const names = (await readdir(authDir).catch(() => [])).filter(name => name.endsWith('.json'))
  for (const name of names) {
    if ((await readAuthFile(authDir, name))?.type === 'agy')
      return true
  }
  return false
}

async function readAuthFile(authDir: string, name: string): Promise<{ type?: string, home?: string } | undefined> {
  if (basename(name) !== name)
    return undefined
  return asJsonValue(AuthFileSchema, await readFile(join(authDir, name), 'utf8').catch(() => undefined))
}

// Only homes this extension created are deleted; an account in the user's own HOME is left alone.
export async function agyAccountHome(root: string, authDir: string, name: string): Promise<string | undefined> {
  const entry = await readAuthFile(authDir, name)
  if (entry?.type !== 'agy' || entry.home === undefined)
    return undefined
  const inside = relative(agyDirectories(root).accountsDir, entry.home)
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? entry.home : undefined
}
