import { describe, expect, it } from 'vitest'
import { pickUpdate } from '../../../src/cliproxy/managed/update-policy'

describe('pickUpdate', () => {
  it.each([
    ['installs when no version is known', undefined, '7.3.0', '7.3.0'],
    ['accepts a newer patch', '7.2.5', '7.2.9', '7.2.9'],
    ['accepts a newer major', '7.2.5', '8.0.0', '8.0.0'],
    ['normalizes leading v', 'v7.2.5', 'v7.3.0', '7.3.0'],
    ['does nothing when current', '7.3.0', '7.3.0', null],
    ['does not downgrade', '8.0.0', '7.3.0', null],
    ['rejects an invalid installed version', 'latest', '7.3.0', null],
    ['rejects an invalid target version', '7.2.5', 'nightly', null],
  ])('%s', (_name, installed, latest, expected) => {
    expect(pickUpdate(installed, latest)).toBe(expected)
  })
})
