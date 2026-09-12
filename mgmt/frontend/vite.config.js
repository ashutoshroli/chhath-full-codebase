import { defineConfig } from 'vite';
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
});
