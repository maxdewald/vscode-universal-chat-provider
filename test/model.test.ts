import { describe, expect, it } from 'vitest'
import { flattenCatalog, mapProxyModels } from '../src/model'

describe('model mapping', () => {
  it('creates one selectable model with a native reasoning selector', () => {
    const models = mapProxyModels(
      [{ id: 'gpt-5.4', owned_by: 'openai' }],
      [{
        slug: 'gpt-5.4',
        display_name: 'GPT-5.4',
        context_window: 400_000,
        max_context_window: 1_000_000,
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast' },
          { effort: 'medium', description: 'Balanced' },
          { effort: 'high', description: 'Deep' },
        ],
        default_reasoning_level: 'medium',
        input_modalities: ['text', 'image'],
      }],
      new Map([['gpt-5.4', {
        id: 'gpt-5.4',
        max_completion_tokens: 128_000,
        supported_parameters: ['tools'],
      }]]),
      { defaultMaxOutputTokens: 16_384 },
    )

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'gpt-5.4',
      maxInputTokens: 272_000,
      maxOutputTokens: 128_000,
      totalContextTokens: 400_000,
      maximumContextTokens: 1_000_000,
      reasoningLevels: ['low', 'medium', 'high'],
      capabilities: {
        imageInput: true,
        toolCalling: true,
      },
    })
    const model = models[0]
    expect(model).toBeDefined()
    expect(model!.configurationSchema?.properties?.reasoningEffort).toMatchObject({
      enum: ['low', 'medium', 'high'],
      enumItemLabels: ['Low', 'Medium', 'High'],
      default: 'medium',
      group: 'navigation',
    })
  })

  it('keeps every provider model while filtering media-only endpoints', () => {
    const models = mapProxyModels(
      [
        { id: 'claude-sonnet', owned_by: 'anthropic' },
        { id: 'gemini-pro', owned_by: 'google' },
        { id: 'image-generation', owned_by: 'openai' },
      ],
      [],
      new Map(),
      { defaultMaxOutputTokens: 8192 },
    )

    expect(models.map(model => model.id)).toEqual(['claude-sonnet', 'gemini-pro'])
  })

  it('flattens provider catalogs and prefers richer duplicate metadata', () => {
    const catalog = flattenCatalog({
      openai: [{ id: 'shared', context_length: 128_000 }],
      aliases: [{ id: 'shared', context_length: 128_000, thinking: { levels: ['low', 'high'] } }],
    })

    expect(catalog.get('shared')?.thinking?.levels).toEqual(['low', 'high'])
  })
})
