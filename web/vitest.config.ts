/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Vitest config for rexpipe-playground-web.
//
// Keeps the svelte plugin active so `.svelte.ts` files with runes
// ($state, $derived, $effect) get compiled before Vitest runs them.
// Without the plugin, `import '.../pipeline-state.svelte.ts'` would
// hit raw `$state(...)` calls that Node doesn't understand.
//
// Playwright tests live in tests/e2e/ and are excluded here —
// they're driven by their own runner via `npm run test:e2e`.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**',
      '**/*.d.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
