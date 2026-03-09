import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load shared constants for client-side use (must match vite.config.ts)
const sharedConstants = JSON.parse(
  readFileSync(resolve(__dirname, '../shared/constants.json'), 'utf8')
);

export default defineConfig({
  plugins: [react()],
  define: {
    __CLIENT_PORT_OFFSET__: JSON.stringify(sharedConstants.CLIENT_PORT_OFFSET),
  },
  test: {
    include: ['__tests__/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['__tests__/setup.ts'],
    testTimeout: 10000,
  },
});
