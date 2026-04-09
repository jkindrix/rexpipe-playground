import { defineConfig, devices } from '@playwright/test';

// Playwright config for rexpipe-playground-web smoke tests.
//
// These tests run against a built production bundle served by
// `vite preview` rather than the dev server, because:
//
//   1. The WASM worker loads its glue module via a dynamic `import()`
//      that Vite's dev server intercepts and rewrites with a `?import`
//      query, causing dev to return HTML instead of the JS module.
//      (The production build has no such transform.) See the docs in
//      src/lib/wasm-worker.ts for why the dynamic import is there.
//
//   2. Tests should verify what actually ships. Running against the
//      production bundle catches bundle-specific regressions (asset
//      path rewrites, base path issues, CSP header interactions, etc.)
//      that dev mode would paper over.
//
// `vite preview --base=/rexpipe-playground/` serves the built dist/
// at the production subpath, matching the GitHub Pages deployment.
// Tests navigate to `/rexpipe-playground/` rather than `/`.
//
// Scope: a handful of smoke tests covering the happy path end-to-end
// (load → WASM ready → seeded pipeline renders → add step → click step
// for intermediate inspection). Not coverage — a reactivity regression
// safety net the type checker can't provide.
//
// Chromium only — Firefox/WebKit coverage can be added later if
// engine-specific bugs surface.
export default defineConfig({
  testDir: './tests/e2e',
  // Each test is allowed up to 60 s; WASM load alone takes ~500 ms on
  // cold cache and CI runners are slower than dev laptops.
  timeout: 60_000,
  expect: {
    // Default to 10 s for most assertions; selectors that wait for
    // "Ready" can take longer due to WASM initialization.
    timeout: 10_000,
  },
  // Fail CI quickly if a test is flaky — a retry masks real regressions.
  retries: process.env.CI ? 1 : 0,
  // Serial execution: we have very few tests, so parallelism isn't
  // worth the worker-state flakiness risk.
  workers: 1,
  reporter: [
    ['list'],
    // HTML report for debugging locally and uploaded as a CI artifact.
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // baseURL is the origin only; tests navigate to the explicit
    // subpath via `page.goto('/rexpipe-playground/')`. This is clearer
    // than embedding the subpath in baseURL and then needing awkward
    // relative navigation (`page.goto('')`) in every test.
    baseURL: 'http://127.0.0.1:5173',
    // Trace on first failure to help debug flakes without a full rerun.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Serve the production bundle for the duration of the test run.
  // `vite preview` respects the `--base` flag so the dist/ output is
  // served at the same subpath the production site uses.
  //
  // This command does NOT run `npm run build` — the build is the
  // caller's responsibility. In CI the workflow runs build as a
  // separate step so a build failure produces a clear "Build
  // production bundle" job error instead of a vague "webServer
  // timed out" message later. Locally, run `npm run build` once
  // before iterating, then `npx playwright test` reuses dist/ until
  // you rebuild manually.
  webServer: {
    command: 'npx vite preview --port 5173 --strictPort --base=/rexpipe-playground/',
    // Playwright polls this URL until it returns 200, signalling the
    // preview server is up and the built assets are ready.
    url: 'http://127.0.0.1:5173/rexpipe-playground/',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Pipe both streams so vite preview errors are visible in the
    // Playwright log instead of silently swallowed.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
