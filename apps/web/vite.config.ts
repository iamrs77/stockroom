import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the API runs separately; in production the server hosts this app on the same origin.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
