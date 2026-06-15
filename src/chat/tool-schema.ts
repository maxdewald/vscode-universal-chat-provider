import { isObject, isStringArray } from '../shared/json'

// Provider adapters can translate richer schemas; this is the stable subset sent by the extension.
const PORTABLE_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'number',
  'object',
  'string',
])

export function normalizeToolSchema(schema: object): object {
  const normalized = normalizeSchema(schema)
  return {
    ...normalized,
    type: 'object',
    properties: normalized.properties ?? {},
  }
}

function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (!isObject(schema))
    return {}

  const result: Record<string, unknown> = {}
  const type = portableType(schema.type)
  if (type !== undefined)
    result.type = type
  if (typeof schema.description === 'string')
    result.description = schema.description

  if (isObject(schema.properties)) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [name, normalizeSchema(value)]),
    )
    result.properties = properties
    const required = Array.isArray(schema.required)
      ? [...new Set(schema.required.filter(
          (name): name is string => typeof name === 'string' && name in properties,
        ))]
      : []
    if (required.length > 0)
      result.required = required
    result.type ??= 'object'
  }

  if (isObject(schema.items)) {
    result.items = normalizeSchema(schema.items)
    result.type ??= 'array'
  }

  if (isStringArray(schema.enum)) {
    result.enum = schema.enum
    result.type ??= 'string'
  }

  return result
}

function portableType(value: unknown): string | undefined {
  const types = [...new Set(
    (Array.isArray(value) ? value : [value])
      .filter((type): type is string => typeof type === 'string' && type !== 'null'),
  )]
  return types.length === 1 && PORTABLE_SCHEMA_TYPES.has(types[0]!)
    ? types[0]
    : undefined
}
