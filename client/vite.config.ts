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
    proxy: proxyConfig,
  },
  preview: {
    proxy: proxyConfig,
  },
});
