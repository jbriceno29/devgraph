import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const root = fileURLToPath(new URL('./src/desktop/', import.meta.url));
export default defineConfig({
  root,
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared/', import.meta.url)),
      '@desktop': fileURLToPath(new URL('./src/desktop/', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
