import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agyCallbackUrl } from '@src/cliproxy/providers/antigravity/accounts'
import { agyAccountHome, agyDirectories, agyPluginConfig, markAgySignIn } from '@src/cliproxy/providers/antigravity/plugin'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTempDirectories } from '../../../support/temp'

const makeTempDirectory = useTempDirectories()

describe('antigravity plugin', () => {
  let root: string
  let authDir: string

  beforeEach(async () => {
    root = await makeTempDirectory('ucp-agy-')
    authDir = join(root, 'auth')
    await mkdir(authDir)
  })

  const installed = async () => {
    await mkdir(agyDirectories(root).pluginDir, { recursive: true })
    await writeFile(join(agyDirectories(root).pluginDir, 'version'), '0.4.0')
  }
  const enabled = async () => ((await agyPluginConfig(root, authDir))?.['configs'] as Record<string, { enabled: boolean }>)['cliproxy-antigravity']!.enabled

  it('leaves plugins out of the config until the plugin is installed', async () => {
    expect(await agyPluginConfig(root, authDir)).toBeUndefined()
  })

  it('enables the plugin only during a sign-in or while an agy account exists', async () => {
    await installed()
    expect(await enabled()).toBe(false)

    await markAgySignIn(root, true)
    expect(await enabled()).toBe(true)
    await markAgySignIn(root, false)
    expect(await enabled()).toBe(false)

    await writeFile(join(authDir, 'claude.json'), '{"type":"claude"}')
    expect(await enabled()).toBe(false)
    await writeFile(join(authDir, 'antigravity-a.json'), '{"type":"agy"}')
    expect(await enabled()).toBe(true)
  })

  it('returns only account homes the extension created', async () => {
    const own = join(agyDirectories(root).accountsDir, 'account-1')
    await writeFile(join(authDir, 'own.json'), JSON.stringify({ type: 'agy', home: own }))
    await writeFile(join(authDir, 'user.json'), JSON.stringify({ type: 'agy', home: '/Users/someone' }))
    await writeFile(join(authDir, 'root.json'), JSON.stringify({ type: 'agy', home: agyDirectories(root).accountsDir }))

    expect(await agyAccountHome(root, authDir, 'own.json')).toBe(own)
    expect(await agyAccountHome(root, authDir, 'user.json')).toBeUndefined()
    expect(await agyAccountHome(root, authDir, 'root.json')).toBeUndefined()
    expect(await agyAccountHome(root, authDir, '../own.json')).toBeUndefined()
  })

  it.each([
    ['4/0AbC-def', 'https://antigravity.google/oauth-callback?code=4%2F0AbC-def&state=s1'],
    ['https://antigravity.google/oauth-callback?code=c&state=s1', 'https://antigravity.google/oauth-callback?code=c&state=s1'],
    ['https://antigravity.google/oauth-callback?code=c&state=other', undefined],
    ['two words', undefined],
  ])('turns pasted %s into a callback URL', (input, expected) => {
    expect(agyCallbackUrl(input, 's1')).toBe(expected)
  })
})
