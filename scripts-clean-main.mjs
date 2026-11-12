import { rmSync } from 'node:fs';
rmSync('dist/main', { recursive: true, force: true });
