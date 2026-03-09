import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Allow CLI to override the server port via VITE_SERVER_PORT env var
const serverPort = process.env.VITE_SERVER_PORT || '4000';
const serverTarget = `http://localhost:${serverPort}`;

// Load shared constants for client-side use
const sharedConstants = JSON.parse(
  readFileSync(resolve(__dirname, '../shared/constants.json'), 'utf8')
);

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
  define: {
    __CLIENT_PORT_OFFSET__: JSON.stringify(sharedConstants.CLIENT_PORT_OFFSET),
  },
  server: {
    port: 3000,
    proxy: proxyConfig,
  },
  preview: {
    port: 3000,
    proxy: proxyConfig,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
