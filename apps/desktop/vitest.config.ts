import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Lightweight unit-test runner for pure renderer logic (no electron, no DOM). Component
// behavior is exercised through the pure view module in src/renderer/src/lib.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/**/*.test.ts'],
  },
})
