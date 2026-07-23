import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      vscode: fileURLToPath(new URL('./test/support/vscode.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './test/coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
      reporter: ['text', 'html', 'json-summary', 'json'],
      reportOnFailure: true,
    },
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
})
