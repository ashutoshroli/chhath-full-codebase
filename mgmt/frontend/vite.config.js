// audit C2 / react-router v7 upgrade: `defineConfig` comes from `vitest/config`, not
// `vite`, so the `test` block below type-checks and vitest reads it — the same import the
// SvelteKit apps use for their vitest config. The build config is unchanged.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const GTM_ID = process.env.VITE_GTM_ID === undefined ? 'GTM-M2JP98W5' : process.env.VITE_GTM_ID;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-gtm-id',
      transformIndexHtml(html) {
        const out = GTM_ID
          ? html
          : html.replace(/<noscript><iframe src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/noscript>/g, '');
        return out
          .replace(/__GTM_ID__/g, JSON.stringify(GTM_ID))
          .replace(/__GTM_ID_RAW__/g, encodeURIComponent(GTM_ID));
      },
    },
  ],
  build: {
    target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88'],
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-utils': ['jspdf', 'html2canvas'],
          'docx-utils': ['docxtemplater', 'pizzip', 'docxtemplater-image-module-free'],
          'vendor': ['react', 'react-dom', 'react-router-dom'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    // The router tests mount components and read the DOM, so they need a browser-like
    // environment. jsdom is opted into globally here because every test in this app is a
    // component/router test (it has no pure-logic suite like the SvelteKit apps do).
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
