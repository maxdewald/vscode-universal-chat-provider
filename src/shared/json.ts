import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

let reportValidationError: ((message: string) => void) | undefined

export function setJsonValidationErrorReporter(reporter: (message: string) => void): void {
  reportValidationError = reporter
}

export function asValue<T extends TSchema>(schema: T, value: unknown): Static<T> | undefined {
  if (Value.Check(schema, value))
    return value

  const errors = [...Value.Errors(schema, value)]
  reportValidationError?.(`TypeBox validation failed: ${JSON.stringify(errors)}`)
  return undefined
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
