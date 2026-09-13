/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// PWA: app-shell offline support. Static assets are precached; the portal API
// (Cloudflare Worker) uses NetworkFirst so visitors always get fresh data when
// online but still see a usable shell + last-good data when offline.
export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        name: 'Navyuvak Chhath Puja Samiti',
        short_name: 'Chhath Puja',
        description:
          'Navyuvak Chhath Puja Samiti, Shaharpura — a read-only public transparency portal: every contribution, expense, loan and committee record, live and accountable. Faith • Unity • Transparency.',
        lang: 'en',
        dir: 'ltr',
        categories: ['finance', 'social', 'utilities'],
        theme_color: '#F27A1A',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Expenses', url: '/expenses' },
          { name: 'Loans', url: '/loans' },
          { name: 'Committee', url: '/committee' },
          { name: 'Downloads', url: '/downloads' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,avif,woff2}'],
        runtimeCaching: [
          {
            // Portal API: prefer network, fall back to cache when offline.
            urlPattern: ({ url }) => /workers\.dev|shaharpura\.com/.test(url.host),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'chhath-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 }
            }
          },
          {
            urlPattern: ({ url }) => /fonts\.(googleapis|gstatic)\.com/.test(url.host),
            handler: 'CacheFirst',
            options: {
              cacheName: 'chhath-fonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
});
