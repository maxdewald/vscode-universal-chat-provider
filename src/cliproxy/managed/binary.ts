import type { OutputChannel } from 'vscode'
import { access, chmod, readdir, rm } from 'node:fs/promises'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { join } from 'node:path'
import { githubFetch, installReleaseAsset } from '@src/cliproxy/managed/github-release'
import semver from 'semver'

const REPO = 'router-for-me/CLIProxyAPI'

interface AssetInfo {
  assetName: string
  binaryName: string
  isZip: boolean
}

export function resolveAsset(platform: NodeJS.Platform, arch: string, version: string): AssetInfo {
  const os = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : 'linux'
  const cpu = arch === 'arm64' ? 'aarch64' : 'amd64'
  const isZip = os === 'windows'
  return {
    assetName: `CLIProxyAPI_${version}_${os}_${cpu}.${isZip ? 'zip' : 'tar.gz'}`,
    binaryName: os === 'windows' ? 'cli-proxy-api.exe' : 'cli-proxy-api',
    isZip,
  }
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export const MIN_CLIPROXY_VERSION = '8.0.3'

export function isSupportedVersion(version: string): boolean {
  return semver.satisfies(normalizeVersion(version), `>=${MIN_CLIPROXY_VERSION}`)
}

export async function resolveVersion(requested: string, signal?: AbortSignal): Promise<string> {
  if (requested.toLowerCase() !== 'latest')
    return normalizeVersion(requested)
  const releases = await githubFetch
    .get(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { signal: signal ?? null })
    .json<{ tag_name: string, prerelease: boolean, assets: { name: string }[] }[]>()
  // Upstream publishes the release before CI uploads its assets, so skip releases that aren't downloadable yet.
  for (const release of releases) {
    const version = normalizeVersion(release.tag_name)
    const names = release.assets.map(asset => asset.name)
    if (!release.prerelease && names.includes('checksums.txt') && names.includes(resolveAsset(osPlatform(), osArch(), version).assetName))
      return version
  }
  throw new Error('Could not determine the latest CLIProxyAPI release.')
}

interface AcquireOptions {
  binDir: string
  requestedVersion: string
  output: OutputChannel
  signal?: AbortSignal
}

interface AcquireResult {
  binaryPath: string
  version: string
}

export async function acquireBinary(options: AcquireOptions): Promise<AcquireResult> {
  let version: string
  try {
    version = await resolveVersion(options.requestedVersion, options.signal)
  }
  catch (error) {
    const cachedVersion = await readInstalledVersion(options.binDir)
    if (cachedVersion === undefined)
      throw error
    options.output.appendLine(`Could not resolve latest CLIProxyAPI release (${error instanceof Error ? error.message : String(error)}). Using cached CLIProxyAPI ${cachedVersion}.`)
    version = cachedVersion
  }
  if (!isSupportedVersion(version))
    throw new Error(`CLIProxyAPI ${version} is no longer supported. Set universalChatProvider.server.version to latest or ${MIN_CLIPROXY_VERSION}+.`)
  const asset = resolveAsset(osPlatform(), osArch(), version)
  const versionDir = join(options.binDir, version)
  const binaryPath = join(versionDir, asset.binaryName)

  if (await access(binaryPath).then(() => true, () => false)) {
    options.output.appendLine(`Using cached CLIProxyAPI ${version} at ${binaryPath}.`)
    return { binaryPath, version }
  }

  options.output.appendLine(`Downloading CLIProxyAPI ${version} (${asset.assetName})...`)
  await rm(versionDir, { recursive: true, force: true })
  await installReleaseAsset(REPO, version, asset.assetName, versionDir, options.signal)

  if (!(await access(binaryPath).then(() => true, () => false)))
    throw new Error(`Extracted archive did not contain ${asset.binaryName}.`)
  if (osPlatform() !== 'win32')
    await chmod(binaryPath, 0o755)

  options.output.appendLine(`Installed CLIProxyAPI ${version} at ${binaryPath}.`)
  await pruneOldVersions(options.binDir, version, options.output)
  return { binaryPath, version }
}

export async function readInstalledVersion(binDir: string): Promise<string | undefined> {
  let entries: string[]
  try {
    entries = await readdir(binDir)
  }
  catch {
    return undefined
  }
  const [newest] = semver.rsort(entries.filter(entry => semver.valid(entry) !== null))
  return newest
}

async function pruneOldVersions(binDir: string, keep: string, output: OutputChannel): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(binDir)
  }
  catch {
    return
  }
  await Promise.all(entries
    .filter(entry => entry !== keep)
    .map(async (entry) => {
      try {
        await rm(join(binDir, entry), { recursive: true, force: true })
        output.appendLine(`Removed stale CLIProxyAPI ${entry}.`)
      }
      catch {}
    }))
}
