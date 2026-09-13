import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Private SPA (management portal): fully static build with a 200.html SPA
 * fallback so hash/deep routes resolve client-side. Same deploy shape as the
 * React app (a static bundle behind auth).
 */
/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '200.html',
      precompress: false,
      strict: false
    }),
    alias: { $lib: './src/lib' },
    prerender: {
      handleHttpError: ({ status }) => {
        if (status === 404) return;
      }
    }
  }
};

export default config;
