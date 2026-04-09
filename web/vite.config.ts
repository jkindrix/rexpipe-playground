import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Remove smoke-test.html from the production bundle after Vite copies
// public/ to dist/. The smoke test lives in public/ so it's accessible
// during `npm run dev` for quick regression checks, but it's a Phase 1
// throwaway and doesn't belong on the deployed site. Keeping it in
// public/ for dev and stripping it at build time is the simplest
// arrangement — no file moves, no parallel directories.
function stripSmokeTest(): Plugin {
  return {
    name: 'rexpipe-strip-smoke-test',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      try {
        rmSync(resolve(outDir, 'smoke-test.html'), { force: true });
      } catch {
        // Non-fatal: if it doesn't exist we don't care.
      }
    },
  };
}

// rexpipe-playground Vite config
//
// The pre-built WASM module lives in public/pkg/ and is served as a static
// asset. Vite copies public/ to dist/ verbatim, so the worker can load
// from `${BASE_URL}pkg/rexpipe_wasm.js` in both dev and production.
//
// The Web Worker is loaded via `new Worker(new URL('./wasm-worker.ts',
// import.meta.url), { type: 'module' })` in wasm-bridge.ts. Vite bundles
// the worker as a separate ES module.
//
// Base path: in production (GitHub Pages deployment at
// https://jkindrix.github.io/rexpipe-playground/), everything needs to
// be served from the /rexpipe-playground/ subpath. In dev, it's served
// from `/`. The `command === 'build'` check switches between them.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/rexpipe-playground/' : '/',
  plugins: [svelte(), stripSmokeTest()],
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
}));
