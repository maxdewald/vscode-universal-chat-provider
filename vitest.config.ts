import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/support/vscode.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        resolve: {
          alias: {
            vscode: fileURLToPath(new URL('./test/support/vscode.ts', import.meta.url)),
          },
        },
        test: {
          name: 'test:unit',
          include: ['test/**/*.test.ts'],
          clearMocks: true,
          restoreMocks: true,
          unstubGlobals: true,
        },
      },
    ],
  },
})
