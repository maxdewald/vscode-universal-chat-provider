import { isPlainObject } from 'moderndash'

/** The value when it is a string, otherwise undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The value when it is a plain object, otherwise undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

/** Type guard for any non-array object (looser than {@link asRecord}). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
