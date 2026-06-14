import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/support/vscode.ts', import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['e2e/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 70_000,
  },
})
