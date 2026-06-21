import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API calls to the Express backend on :3001, so the React
// app can use relative URLs (/suggest, /search, ...) in both dev and the
// production build that the backend serves from /dist.
const target = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/suggest': target,
      '/search': target,
      '/trending': target,
      '/cache': target,
      '/metrics': target,
      '/health': target
    }
  }
});
