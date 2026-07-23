// @ts-check
import antfu from '@antfu/eslint-config'
import importAlias from '@dword-design/eslint-plugin-import-alias'

export default antfu(
  {
    type: 'lib',
    typescript: {
      tsconfigPath: 'tsconfig.json',
    },
    ignores: [
      '.vscode-test',
      'vscode*.d.ts',
    ],
  },
  importAlias.configs.recommended,
  {
    rules: {
      '@dword-design/import-alias/prefer-alias': [
        'error',
        {
          aliasForSubpaths: true,
          shouldReadBabelConfig: false,
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/',
              message: 'Use the @src/ alias for source imports.',
            },
          ],
        },
      ],
    },
  },
)
