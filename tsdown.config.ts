import { execSync } from 'node:child_process'
import { defineConfig } from 'tsdown'

export default defineConfig({
  tsconfig: true,
  entry: [
    'src/index.ts',
  ],
  format: ['cjs'],
  shims: false,
  dts: false,
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: id => id !== 'vscode' && !id.startsWith('node:'),
    // Silences tsdown's "unintended bundling" hint; bundling is deliberate here.
    onlyBundle: false,
  },
  hooks(hooks) {
    hooks.hookOnce('build:prepare', () => {
      execSync('pnpm generate', { stdio: 'inherit' })
    })
  },
})
