import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    hmr: false,
    cors: true,
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
