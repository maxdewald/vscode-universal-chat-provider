import { describe, expect, it } from 'vitest'
import { normalizeToolSchema } from '../src/tool-schema'

describe('tool schema normalization', () => {
  it('keeps a portable schema subset and drops unknown annotations automatically', () => {
    expect(normalizeToolSchema({
      $comment: 'root metadata',
      type: 'object',
      title: 'Lookup input',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          description: 'Lookup mode',
          enum: ['fast', 'thorough'],
          enumDescriptions: ['Use less time', 'Use more time'],
          default: 'fast',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
        },
        tags: {
          type: 'array',
          items: {
            type: ['string', 'null'],
            pattern: '^[a-z]+$',
          },
        },
        $comment: {
          type: 'string',
          description: 'A real property named $comment',
        },
      },
      required: ['mode', 'missing', 'mode'],
    })).toEqual({
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'Lookup mode',
          enum: ['fast', 'thorough'],
        },
        count: {
          type: 'integer',
        },
        tags: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        $comment: {
          type: 'string',
          description: 'A real property named $comment',
        },
      },
      required: ['mode'],
    })
  })

  it('always produces an object parameter schema', () => {
    expect(normalizeToolSchema({
      anyOf: [
        { type: 'string' },
        { type: 'number' },
      ],
    })).toEqual({
      type: 'object',
      properties: {},
    })
  })
})
