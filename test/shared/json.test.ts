import { Type } from '@sinclair/typebox'
import { asValue, setJsonValidationErrorReporter } from '@src/shared/json'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('json schema validation', () => {
  const report = vi.fn()

  beforeEach(() => {
    report.mockReset()
    setJsonValidationErrorReporter(report)
  })

  it('reports TypeBox validation errors', () => {
    const schema = Type.Object({ name: Type.String() })

    expect(asValue(schema, { name: 42 })).toBeUndefined()
    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]?.[0]).toContain('TypeBox validation failed:')
    expect(report.mock.calls[0]?.[0]).toContain('/name')
    expect(report.mock.calls[0]?.[0]).toContain('string')
  })

  it('does not report valid values', () => {
    const value = { name: 'Claude' }

    expect(asValue(Type.Object({ name: Type.String() }), value)).toBe(value)
    expect(report).not.toHaveBeenCalled()
  })
})
