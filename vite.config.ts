import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  // OneDrive can lock files within node_modules while it syncs. Vite's cache
  // is disposable, so keep it out of the synced project folder.
  cacheDir: resolve(tmpdir(), 'shopping-canvas-vite-cache'),
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
