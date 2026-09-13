import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Fully static output (adapter-static) so this deploys to the same Vercel /
 * Cloudflare static hosting the other Public frontends use — no server runtime.
 * `fallback: '200.html'` gives us an SPA-style fallback so client-side routes
 * (e.g. /contributors) resolve even without per-route prerendered HTML.
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
    alias: {
      $lib: './src/lib'
    },
    prerender: {
      // With a 200.html SPA fallback, any route not prerendered still resolves
      // client-side. Don't fail the build on internal links whose pages are
      // prerendered later in the crawl / handled at runtime.
      handleHttpError: ({ status, path, message }) => {
        if (status === 404) return;
        throw new Error(message + ` (${path})`);
      }
    }
  }
};

export default config;
