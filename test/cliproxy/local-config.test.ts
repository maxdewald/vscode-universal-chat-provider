import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLocalProxyConfig } from '../../src/cliproxy/local-config'
import { useTempDirectories } from '../support/temp'

const makeTempDirectory = useTempDirectories()

describe('local CLIProxyAPI config', () => {
  it('selects the first usable API key', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, [
      'api-keys:',
      '  - your-api-key-1',
      '  - " actual-key "',
      '  - later-key',
    ].join('\n'))

    await expect(readLocalProxyConfig(configPath)).resolves.toEqual({
      path: configPath,
      apiKey: 'actual-key',
    })
  })

  it('omits placeholder keys', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, [
      'api-keys:',
      '  - your-api-key',
    ].join('\n'))

    await expect(readLocalProxyConfig(configPath)).resolves.toEqual({
      path: configPath,
    })
  })

  it('reads a plaintext management key, ignoring hashed keys', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, [
      'api-keys:',
      '  - actual-key',
      'remote-management:',
      '  secret-key: super-secret',
    ].join('\n'))

    await expect(readLocalProxyConfig(configPath)).resolves.toEqual({
      path: configPath,
      apiKey: 'actual-key',
      managementKey: 'super-secret',
    })
  })

  it('ignores a bcrypt-hashed management secret', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, [
      'auth-dir: auth',
      'remote-management:',
      '  secret-key: "$2a$10$abcdefghijklmnopqrstuv"',
    ].join('\n'))

    const config = await readLocalProxyConfig(configPath)
    expect(config.managementKey).toBeUndefined()
  })

  it('rejects malformed YAML', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, 'api-keys: [')

    await expect(readLocalProxyConfig(configPath)).rejects.toThrow()
  })
})
