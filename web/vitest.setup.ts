// Vitest per-test setup.
//
// Extend Vitest's `expect` with jest-dom's semantic matchers
// (toBeInTheDocument, toHaveClass, etc.) for any tests that render
// Svelte components via @testing-library/svelte.
import '@testing-library/jest-dom/vitest';
