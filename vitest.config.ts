import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('./src/', import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      '@shared': `${root}shared`,
      '@domain': `${root}domain`,
      '@application': `${root}application`,
      '@infrastructure': `${root}infrastructure`,
      '@desktop': `${root}desktop`,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/ui/setup.ts'],
    // Full-shell UI tests sometimes need close to 5 s when 45 files run in parallel; they are not slow in isolation.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
