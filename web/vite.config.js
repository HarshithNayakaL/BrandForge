import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // The browser never talks to the model APIs; everything goes through the api service.
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: true } },
  },
});
