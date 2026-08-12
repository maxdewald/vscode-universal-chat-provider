import { pickUpdate } from '@src/cliproxy/managed/update-policy'
import { describe, expect, it } from 'vitest'

describe('pickUpdate', () => {
  it.each([
    ['installs when no version is known', undefined, '7.2.9', '7.2.9'],
    ['installs the latest major when no version is known', undefined, '8.0.0', '8.0.0'],
    ['accepts a newer patch', '7.2.5', '7.2.9', '7.2.9'],
    ['accepts a newer major', '7.2.5', '8.0.0', '8.0.0'],
    ['normalizes leading v', 'v7.2.5', 'v7.2.9', '7.2.9'],
    ['does nothing when current', '7.2.9', '7.2.9', null],
    ['does not downgrade toward an older release', '7.2.9', '7.2.5', null],
    ['rejects an invalid installed version', 'latest', '7.2.9', null],
    ['rejects an invalid target version', '7.2.5', 'nightly', null],
  ])('%s', (_name, installed, latest, expected) => {
    expect(pickUpdate(installed, latest)).toBe(expected)
  })

  it('can cap and downgrade updates when needed', () => {
    expect(pickUpdate('8.1.0', '8.1.0', '7.2.115')).toBe('7.2.115')
  })
})
