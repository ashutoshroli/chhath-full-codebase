/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Match the React app's browser targets so the bundle runs on the same
    // older devices committee members use.
    target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88']
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
});
