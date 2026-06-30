import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// All runtime config is injected via env vars (VITE_*) so the same build
// can be self-hosted with different Supabase / SMTP / branding settings.
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
  },
});
