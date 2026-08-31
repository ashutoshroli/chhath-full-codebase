import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Vite's default target ('modules') assumes a fairly recent browser. Several
    // committee members are on older Android WebViews / iOS Safari builds, so pin
    // an explicit floor and let esbuild down-level the SYNTAX it can (`??=`,
    // logical assignment, optional catch binding, class fields).
    //
    // This does NOT cover modern *runtime methods*: esbuild rewrites syntax only
    // and ships no shims, so `Array.prototype.at` — which `marked` and the APNG
    // decoder in the pdf chunk both call, and which produced 5 production rows of
    // "this.i.at is not a function" — still reaches the browser raw. That one is
    // fixed by src/polyfills.js, imported first in main.jsx. Verified by grepping
    // a real build for `.at(`.
    target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88'],
    // Ensure consistent chunk hashing to prevent cache issues
    rollupOptions: {
      output: {
        manualChunks: {
          // Group heavy PDF/DOCX dependencies together
          'pdf-utils': ['jspdf', 'html2canvas'],
          'docx-utils': ['docxtemplater', 'pizzip', 'docxtemplater-image-module-free'],
          'vendor': ['react', 'react-dom', 'react-router-dom'],
        },
        // Use contenthash for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit (docxtemplater is heavy)
    chunkSizeWarningLimit: 1000,
  },
});
