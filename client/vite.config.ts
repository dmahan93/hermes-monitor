import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Allow CLI to override the server port via VITE_SERVER_PORT env var
const serverPort = process.env.VITE_SERVER_PORT || '4000';
const serverTarget = `http://localhost:${serverPort}`;

const proxyConfig = {
  '/api': serverTarget,
  '/agent': serverTarget,
  '/ticket': serverTarget,  // backward compat (server handles /ticket too)
  '/screenshots': serverTarget,
  '/ws': {
    target: `ws://localhost:${serverPort}`,
    ws: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4000',
      '/agent': 'http://localhost:4000',
      '/ticket': 'http://localhost:4000',  // backward compat (server handles /ticket too)
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
    proxy: proxyConfig,
  },
  preview: {
    port: 3000,
    proxy: proxyConfig,
  },
});
