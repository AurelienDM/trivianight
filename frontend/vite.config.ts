import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../backend/src/shared'),
    },
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
  server: {
    port: 43127,
    host: true,
    proxy: {
      '/api': 'http://localhost:43128',
      '/media': 'http://localhost:43128',
    },
  },
});
