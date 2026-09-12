// Astro build configuration for the v2 public portal.
//
// WHY THESE CHOICES
//   output: 'static'  The portal is a read-only public site fed by the public
//                     Worker at runtime (client fetch), so there is no server to
//                     run — a static build deploys to Vercel's CDN for the fastest
//                     possible first paint and the cheapest hosting.
//   integrations      @astrojs/tailwind wires Tailwind into the build so we get
//                     utility CSS + the class-based dark mode the theme toggle
//                     relies on, with zero manual PostCSS config.
//   site              Derived from the shared config module's PUBLIC_SITE_URL
//                     fallback so canonical URLs / sitemap generation use the same
//                     origin the rest of the app resolves, and a missing env var
//                     still yields a valid absolute origin.
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { siteUrl } from './src/config.js';

export default defineConfig({
  output: 'static',
  site: siteUrl,
  integrations: [tailwind()],
});
