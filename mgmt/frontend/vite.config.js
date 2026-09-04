import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// audit L-21: the GTM container id was hardcoded in index.html next to a comment
// telling the reader to replace it — so there was no way to know whether the value
// there was real or the placeholder. It comes from the environment now.
//
// The default is the id that has been shipping, so a build with no env var set
// behaves exactly as before. Set VITE_GTM_ID='' to ship no analytics (what a local
// build wants).
const GTM_ID = process.env.VITE_GTM_ID === undefined ? 'GTM-M2JP98W5' : process.env.VITE_GTM_ID;

export default defineConfig({
  plugins: [
    react(),
    {
      // index.html is not processed by the JS pipeline, so `define` does not reach
      // it. transformIndexHtml is the documented hook for exactly this.
      name: 'inject-gtm-id',
      transformIndexHtml(html) {
        // With no container configured, drop the <noscript> iframe entirely rather
        // than shipping a googletagmanager request with an empty id. The <script>
        // half already self-disables via `if (!gtmId) return;`.
        const out = GTM_ID
          ? html
          : html.replace(/<noscript><iframe src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/noscript>/g, '');
        return out
          .replace(/__GTM_ID__/g, JSON.stringify(GTM_ID))       // inside <script>
          .replace(/__GTM_ID_RAW__/g, encodeURIComponent(GTM_ID)); // inside a URL
      },
    },
  ],
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
    // audit P-10: this was raised to 1000 kB to silence the warning about the
    // deliberately-large `pdf-utils` (593 kB) and `docx-utils` (365 kB) chunks —
    // which also silenced it for every OTHER chunk, including the entry chunk that
    // every volunteer downloads on a phone over rural mobile data.
    //
    // 600 kB still covers the two known-heavy lazy chunks without hiding a
    // regression in the ~191 kB entry chunk. CI additionally fails outright if the
    // entry chunk passes 230,000 bytes (.github/workflows/ci.yml), which is the
    // check that actually protects it — this limit just makes a local build noisy
    // before CI does.
    chunkSizeWarningLimit: 600,
  },
});
