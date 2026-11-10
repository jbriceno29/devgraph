import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('./src/', import.meta.url));
export default defineConfig({
  resolve: { alias: {
    '@shared': `${root}shared`, '@domain': `${root}domain`,
    '@application': `${root}application`, '@infrastructure': `${root}infrastructure`, '@desktop': `${root}desktop`,
  } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
