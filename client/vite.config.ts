import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      '/api': 'http://localhost:4051',
      '/ticket': 'http://localhost:4051',
      '/ws': {
        target: 'ws://localhost:4051',
        ws: true,
      },
    },
  },
});
