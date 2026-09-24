import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// In development the API server runs separately (`npm run dev:server`, port
// 3000); vite proxies API and file requests to it so everything stays on one
// origin, exactly like in production.
const apiServer = process.env.API_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': apiServer,
      '/files': apiServer,
      // Branding from Admin Config (falls back to public/config.js without the server).
      '/config.js': apiServer,
    },
  },
});
