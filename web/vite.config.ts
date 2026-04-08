import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// rexpipe-playground Vite config
//
// The pre-built WASM module lives in public/pkg/ and is served as a static
// asset. Vite copies public/ to dist/ verbatim, so `/pkg/rexpipe_wasm.js`
// works in both dev and production.
//
// The Web Worker is loaded via `new Worker(new URL('./wasm-worker.ts',
// import.meta.url), { type: 'module' })` in wasm-bridge.ts. Vite bundles
// the worker as a separate ES module.
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  // Don't scan the smoke-test.html in public/ as a second entry point.
  // Vite's scanner would try to rewrite imports inside it, which fails
  // because the smoke test imports from the same /pkg/ path that the
  // main app does (and Vite handles that via public/ passthrough).
  optimizeDeps: {
    entries: ['index.html'],
  },
});
