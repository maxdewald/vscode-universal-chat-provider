import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { kyFetch } from '@src/shared/kyFetch'
import { unzipSync } from 'fflate'
import { parseTarGzip } from 'nanotar'

// ky retries transient failures (5xx/429/network) and honors Retry-After on rate limits.
export const githubFetch = kyFetch.extend({
  headers: { 'User-Agent': 'universal-chat-provider-vscode' },
  retry: { limit: 3 },
  timeout: false,
})

export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(\S.*)$/i.exec(line.trim())
    if (match)
      result.set(match[2]!.trim(), match[1]!.toLowerCase())
  }
  return result
}

export async function installReleaseAsset(repo: string, version: string, assetName: string, dest: string, signal?: AbortSignal): Promise<void> {
  const base = `https://github.com/${repo}/releases/download/v${version}`
  const options = { signal: signal ?? null }
  const [archiveResponse, checksumResponse] = await Promise.all([
    githubFetch.get(`${base}/${assetName}`, options),
    githubFetch.get(`${base}/checksums.txt`, options),
  ])
  const archive = new Uint8Array(await archiveResponse.arrayBuffer())
  const expected = parseChecksums(await checksumResponse.text()).get(assetName)
  if (expected === undefined)
    throw new Error(`No checksum found for ${assetName}.`)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected)
    throw new Error(`Checksum mismatch for ${assetName} (expected ${expected}, got ${actual}).`)
  await extractArchive(archive, assetName.endsWith('.zip'), dest)
}

export async function extractArchive(archive: Uint8Array, isZip: boolean, dest: string): Promise<void> {
  const entries = isZip
    ? Object.entries(unzipSync(archive)).map(([name, data]) => ({ name, data }))
    : (await parseTarGzip(archive)).map(item => ({ name: item.name, data: item.data }))

  for (const { name, data } of entries) {
    if (data === undefined || name.endsWith('/'))
      continue
    if (name.split('/').includes('..'))
      throw new Error(`Refusing to extract unsafe path: ${name}`)
    const target = join(dest, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
}
