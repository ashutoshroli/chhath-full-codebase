import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { siteUrl } from './src/config.js';

export default defineConfig({
  output: 'static',
  site: siteUrl,
  integrations: [tailwind()],
});
