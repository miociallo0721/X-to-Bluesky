import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@atproto')) {
            return 'vendor-atproto';
          }
          if (id.includes('node_modules/jszip')) {
            return 'vendor-jszip';
          }
          if (id.includes('src/embeddedApi') || id.includes('src/embeddedStore')) {
            return 'embedded-runtime';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3847',
    },
  },
});
