import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export function asValue<T extends TSchema>(schema: T, value: unknown): Static<T> | undefined {
  return Value.Check(schema, value) ? value : undefined
}

export function asJsonValue<T extends TSchema>(schema: T, value: unknown): Static<T> | undefined {
  if (typeof value !== 'string')
    return undefined
  try {
    return asValue(schema, JSON.parse(value))
  }
  catch {
    return undefined
  }
}
