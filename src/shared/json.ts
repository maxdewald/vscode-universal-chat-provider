import { isPlainObject } from 'moderndash'

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}
