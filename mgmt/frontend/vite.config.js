import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Ensure consistent chunk hashing
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
