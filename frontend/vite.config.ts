import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4200',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Große Bibliotheken in eigene Chunks aufteilen → kleinere Dateien,
        // bessere Browser-Zwischenspeicherung, keine Größen-Warnung mehr.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('xterm')) return 'xterm';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('qrcode')) return 'qr';
            if (id.includes('react')) return 'react';
            return 'vendor';
          }
        },
      },
    },
  },
});
