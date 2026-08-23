import { isHttpUrl, urlHostname } from '@src/shared/url'
import { describe, expect, it } from 'vitest'

describe('url helpers', () => {
  it('parses hostnames', () => {
    expect(urlHostname('https://docs.example.com/path')).toBe('docs.example.com')
    expect(urlHostname('not a url')).toBeUndefined()
  })

  it('accepts only HTTP URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('command:workbench.action.openSettings')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})
