import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// In development the API server runs separately (`npm run dev:server`, port
// 3000); vite proxies API and file requests to it so everything stays on one
// origin, exactly like in production.
const apiServer = process.env.API_SERVER ?? 'http://localhost:3000';

// The proxy rewrites Host to the API server's; pass the browser's host on so
// the server's same-origin guard (server/index.ts) compares like with like.
const toApi = {
  target: apiServer,
  configure: (proxy: import('vite').HttpProxy.Server) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host);
    });
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': toApi,
      '/files': toApi,
      // Branding from Admin Config (falls back to public/config.js without the server).
      '/config.js': toApi,
    },
  },
});
