import { sveltekit } from '@sveltejs/kit/vite';
// audit PR-47: `defineConfig` comes from `vitest/config`, not `vite`. Vitest 5 stopped
// augmenting vite's own config type through `/// <reference types="vitest" />`, so the
// `test` block below no longer type-checks against vite's `defineConfig`. Documented
// migration; same function, re-exported with the test types.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Match the React app's browser targets so the bundle runs on the same
    // older devices committee members use.
    target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88']
  },
  test: {
    // `node` stays the default: the flags/permissions/core tests are pure TS and are much
    // faster without a DOM. A component test opts in per file with
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}']
  },
  // Svelte ships separate server and client builds. Without this, `mount()` resolves to the
  // SSR build and throws `lifecycle_function_unavailable`, so no component behaviour (focus,
  // keyboard, ARIA wiring) could be tested at all. Gated on VITEST so the production build
  // keeps resolving exactly as before.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
