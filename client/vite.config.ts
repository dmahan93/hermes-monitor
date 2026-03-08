import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyConfig = {
  '/api': 'http://localhost:4000',
  '/agent': 'http://localhost:4000',
  '/ticket': 'http://localhost:4000',  // backward compat (server handles /ticket too)
  '/screenshots': 'http://localhost:4000',
  '/ws': {
    target: 'ws://localhost:4000',
    ws: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: proxyConfig,
  },
  preview: {
    port: 3000,
    proxy: proxyConfig,
  },
});
