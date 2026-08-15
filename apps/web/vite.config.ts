import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin in dev too: cookies + relative URLs just work.
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false, emptyOutDir: true },
});
