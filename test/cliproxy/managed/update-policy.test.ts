import { pickUpdate } from '@src/cliproxy/managed/update-policy'
import { describe, expect, it } from 'vitest'

describe('pickUpdate', () => {
  it.each([
    ['installs when no version is known', undefined, '7.2.9', '7.2.9'],
    ['caps a fresh install at the maximum', undefined, '8.0.0', '7.2.115'],
    ['accepts a newer patch', '7.2.5', '7.2.9', '7.2.9'],
    ['caps a newer major at the maximum', '7.2.5', '8.0.0', '7.2.115'],
    ['normalizes leading v', 'v7.2.5', 'v7.2.9', '7.2.9'],
    ['does nothing when current', '7.2.9', '7.2.9', null],
    ['does nothing at the maximum', '7.2.115', '8.0.0', null],
    ['downgrades the version that broke prompt caching', '7.2.116', '8.0.0', '7.2.115'],
    ['downgrades a newer major', '8.1.0', '8.1.0', '7.2.115'],
    ['does not downgrade toward an older release', '7.2.9', '7.2.5', null],
    ['rejects an invalid installed version', 'latest', '7.2.9', null],
    ['rejects an invalid target version', '7.2.5', 'nightly', null],
  ])('%s', (_name, installed, latest, expected) => {
    expect(pickUpdate(installed, latest)).toBe(expected)
  })
})
