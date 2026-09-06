import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readLocalProxyConfig } from '@src/cliproxy/configuration/local-config'
import { describe, expect, it } from 'vitest'
import { useTempDirectories } from '../../support/temp'

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

  it.each(['super-secret', '$2a$10$abcdefghijklmnopqrstuv'])('ignores management key %s', async (managementKey) => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, [
      'api-keys:',
      '  - actual-key',
      'remote-management:',
      `  secret-key: "${managementKey}"`,
    ].join('\n'))

    await expect(readLocalProxyConfig(configPath)).resolves.toEqual({
      path: configPath,
      apiKey: 'actual-key',
    })
  })

  it('rejects malformed YAML', async () => {
    const directory = await makeTempDirectory('universal-chat-provider-config-')
    const configPath = join(directory, 'config.yaml')
    await writeFile(configPath, 'api-keys: [')

    await expect(readLocalProxyConfig(configPath)).rejects.toThrow()
  })
})
