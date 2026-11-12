import { describe, expect, it } from 'vitest';
import { proposeAgentAccess, writablePathIssue } from '../../src/modules/projects/domain/agent-access.js';

describe('proposeAgentAccess (plan REP, R1)', () => {
  it('takes the code folders, the tests and the root configuration of a Next repository, not docs or tooling', () => {
    const access = proposeAgentAccess({
      topLevel: [
        'app/',
        'components/',
        'lib/',
        'tests/',
        'docs/',
        '.github/',
        'public/',
        'next.config.mjs',
        'package.json',
        'tsconfig.json',
        'LICENSE',
        'pnpm-lock.yaml',
      ],
      packageJson: JSON.stringify({
        scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'next lint' },
      }),
    });
    expect(access.writable).toEqual([
      { pattern: 'app/**', reason: 'CODE' },
      { pattern: 'components/**', reason: 'CODE' },
      { pattern: 'lib/**', reason: 'CODE' },
      { pattern: 'tests/**', reason: 'TESTS' },
      { pattern: 'public/**', reason: 'CODE' },
      { pattern: 'next.config.mjs', reason: 'CONFIG' },
      { pattern: 'package.json', reason: 'CONFIG' },
      { pattern: 'tsconfig.json', reason: 'CONFIG' },
      { pattern: 'node_modules/**', reason: 'GENERATED' },
      { pattern: 'dist/**', reason: 'GENERATED' },
      { pattern: 'target/**', reason: 'GENERATED' },
      { pattern: 'coverage/**', reason: 'GENERATED' },
    ]);
    // pnpm lockfile → pnpm; checks in order test, lint, build (no typecheck script).
    expect(access.verificationCommands).toEqual(['pnpm test', 'pnpm run lint', 'pnpm run build']);
  });
  it("skips npm's placeholder test script and a manifest that does not parse", () => {
    const placeholder = JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1', typecheck: 'tsc' },
    });
    expect(proposeAgentAccess({ topLevel: ['src/'], packageJson: placeholder }).verificationCommands).toEqual([
      'npm run typecheck',
    ]);
    expect(proposeAgentAccess({ topLevel: ['src/'], packageJson: '{nope' }).verificationCommands).toEqual([]);
    expect(proposeAgentAccess({ topLevel: ['src/'], packageJson: null }).verificationCommands).toEqual([]);
  });
  it('refuses paths outside the repository, secrets, Git internals and shell characters', () => {
    expect(writablePathIssue('app/**')).toBeNull();
    expect(writablePathIssue('../x')).toMatch(/salir del repositorio/);
    expect(writablePathIssue('/etc/**')).toMatch(/relativa/);
    expect(writablePathIssue('.env.local')).toMatch(/prohibida/);
    expect(writablePathIssue('.git/hooks/**')).toMatch(/prohibida/);
    expect(writablePathIssue('src/$(rm)')).toMatch(/caracteres/);
  });
});
