import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  GitRepositoryScanner,
  isSafeRelativePath,
  isSensitivePath,
  redactSecrets,
} from '../../src/modules/projects/infrastructure/repository-scanner.js';
import { MAX_SCAN_BYTES } from '@shared/contracts/repository-scan.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'pipe',
  });
/** A temporary repository with `files` written, plus a sibling folder outside it holding a secret. */
function repo(files: Record<string, string>, { commit = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'graphdev2-scan-'));
  roots.push(base);
  const root = join(base, 'app'),
    outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.css'), ':root { --leaked: #ff0000; } /* OUTSIDE-SECRET */');
  writeFileSync(join(outside, 'package.json'), '{"name":"OUTSIDE-SECRET"}');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, 'init', '-q', '-b', 'main');
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  }
  return { root, outside };
}
const scanner = new GitRepositoryScanner();
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('repository scan (brownfield)', () => {
  it('reads manifests, structure and styles of a React/Tailwind project and infers nothing itself', async () => {
    const { root } = repo({
      'package.json': JSON.stringify(
        {
          name: 'tienda',
          scripts: { test: 'vitest run', dev: 'vite' },
          dependencies: { react: '^18.3.1' },
          devDependencies: { vite: '^5.4.0', tailwindcss: '^3.4.0' },
        },
        null,
        2,
      ),
      'tailwind.config.js': 'export default { theme: { extend: { colors: { brand: "#0f766e" } } } };\n',
      'src/styles/tokens.css': ':root {\n  --color-primary: #0f766e;\n  --radius: 8px;\n}\n',
      'src/index.css': '@tailwind base;\n@tailwind components;\n',
      'src/App.tsx': 'export function App() { return <main/>; }\n',
      'src/components/Button.tsx': 'export const Button = () => <button/>;\n',
      'README.md': '# Tienda\n\nnpm test\n',
    });
    const scan = await scanner.scan(root);
    expect(scan).toMatchObject({ repositoryName: 'app', hasCode: true, truncated: false, totalFiles: 7 });
    expect(scan.topLevel).toEqual(['README.md', 'package.json', 'src/', 'tailwind.config.js']);
    expect(scan.directories).toContainEqual({ path: 'src/components', files: 1 });
    expect(scan.languages).toContainEqual({ language: 'TypeScript', files: 2 });
    expect(scan.files.map(file => [file.kind, file.path])).toEqual([
      ['MANIFEST', 'package.json'],
      ['README', 'README.md'],
      ['STYLE', 'tailwind.config.js'],
      ['STYLE', 'src/styles/tokens.css'],
      ['STYLE', 'src/index.css'],
    ]);
    expect(scan.files.find(file => file.path === 'src/styles/tokens.css')!.content).toContain(
      '--color-primary: #0f766e',
    );
    // Source code is never read: only manifests, README, styles and CI.
    expect(JSON.stringify(scan)).not.toContain('export function App');
  });

  it('respects .gitignore, also for tracked files that match it, and never lists generated folders', async () => {
    const { root } = repo(
      {
        '.gitignore': 'private/\n*.log\n',
        'package.json': '{}',
        'src/a.js': '1',
        'node_modules/x/package.json': '{"name":"vendored"}',
        'build/out.js': 'x',
      },
      { commit: false },
    );
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    // Ignored after the fact but still tracked, and ignored untracked files.
    mkdirSync(join(root, 'private'));
    writeFileSync(join(root, 'private', 'notes.md'), 'PRIVATE-NOTE');
    writeFileSync(join(root, 'debug.log'), 'LOG-LINE');
    writeFileSync(join(root, 'tracked.log'), 'TRACKED-LOG');
    git(root, 'add', '-f', 'tracked.log');
    git(root, 'commit', '-q', '-m', 'log');
    const scan = await scanner.scan(root);
    const text = JSON.stringify(scan);
    for (const hidden of [
      'PRIVATE-NOTE',
      'LOG-LINE',
      'TRACKED-LOG',
      'vendored',
      'private/',
      'debug.log',
      'tracked.log',
    ])
      expect(text).not.toContain(hidden);
    expect(scan.excluded.ignored).toBeGreaterThanOrEqual(3);
    expect(scan.excluded.generated).toBe(2);
    expect(scan.topLevel).toEqual(['.gitignore', 'package.json', 'src/']);
  });

  it('never opens secrets: .env, keys, credentials, .npmrc; values that look like secrets are redacted', async () => {
    const { root } = repo({
      '.env': 'API_KEY=ENV-SECRET',
      '.env.production': 'X=ENV-PROD-SECRET',
      'config/id_rsa': 'RSA-SECRET',
      'certs/server.pem': 'PEM-SECRET',
      'certs/server.key': 'KEY-SECRET',
      'credentials.json': '{"c":"CRED-SECRET"}',
      '.npmrc': '//registry.npmjs.org/:_authToken=NPMRC-SECRET',
      '.ssh/config': 'SSH-SECRET',
      'my-secrets.yaml': 'YAML-SECRET',
      'package.json': JSON.stringify({
        name: 'x',
        config: { apiKey: 'abcd1234efgh5678ijkl9012' },
        repository: 'https://user:hunter2pass@example.com/repo.git',
      }),
      'src/main.js': '1',
    });
    const scan = await scanner.scan(root);
    const text = JSON.stringify(scan);
    for (const secret of [
      'ENV-SECRET',
      'ENV-PROD-SECRET',
      'RSA-SECRET',
      'PEM-SECRET',
      'KEY-SECRET',
      'CRED-SECRET',
      'NPMRC-SECRET',
      'SSH-SECRET',
      'YAML-SECRET',
      'abcd1234efgh5678ijkl9012',
      'hunter2pass',
    ])
      expect(text).not.toContain(secret);
    expect(scan.excluded.secrets).toBe(9);
    expect(scan.files.map(file => file.path)).toEqual(['package.json']);
    expect(scan.files[0]!.content).toContain('[REDACTADO]');
  });

  it('does not follow symbolic links, to files or folders, even through a tracked path whose folder became a link', async () => {
    const { root, outside } = repo({
      'package.json': '{"name":"inside"}',
      'theme/tokens.css': ':root{--ok:#000}',
      'src/a.js': '1',
    });
    // Untracked links to a file and to a folder outside the repository.
    symlinkSync(join(outside, 'secret.css'), join(root, 'global.css'));
    symlinkSync(outside, join(root, 'styles'));
    // A tracked path whose folder is replaced by a link that points outside: git still lists theme/tokens.css.
    rmSync(join(root, 'theme'), { recursive: true });
    mkdirSync(join(outside, 'theme'));
    writeFileSync(join(outside, 'theme', 'tokens.css'), ':root{--x:1} /* OUTSIDE-SECRET */');
    symlinkSync(join(outside, 'theme'), join(root, 'theme'));
    const scan = await scanner.scan(root);
    expect(JSON.stringify(scan)).not.toContain('OUTSIDE-SECRET');
    expect(JSON.stringify(scan)).not.toContain('--leaked');
    // global.css, styles/, the link theme itself and theme/tokens.css reached through it.
    expect(scan.excluded.symlinks).toBe(4);
    expect(scan.files.map(file => file.path)).toEqual(['package.json']);
  });

  it('caps a huge file and keeps the whole scan within 48 KB, however many style and manifest files there are', async () => {
    const huge = JSON.stringify({ name: 'grande', description: 'x'.repeat(3 * 1024 * 1024) });
    const css = Array.from({ length: 20_000 }, (_, index) =>
      index % 50 === 0
        ? `  --token-${index}: #${String(index).padStart(6, '0')};`
        : `.c${index} { margin: ${index}px; }`,
    ).join('\n');
    const files: Record<string, string> = {
      'package.json': huge,
      'src/theme.css': css,
      'README.md': 'r'.repeat(100_000),
    };
    for (let index = 0; index < 8; index++)
      files[`packages/p${index}/package.json`] = JSON.stringify({ name: `p${index}`, d: 'y'.repeat(20_000) });
    for (let index = 0; index < 8; index++)
      files[`src/styles/colors-${index}.css`] = `:root{${'--c:#123456;'.repeat(2000)}}`;
    const { root } = repo(files);
    const scan = await scanner.scan(root);
    expect(bytes(scan)).toBeLessThanOrEqual(MAX_SCAN_BYTES);
    const pkg = scan.files.find(file => file.path === 'package.json')!;
    expect(pkg).toMatchObject({ bytes: Buffer.byteLength(huge), truncated: true });
    expect(Buffer.byteLength(pkg.content)).toBeLessThanOrEqual(8 * 1024);
    // A large stylesheet keeps its token lines, not its first rules.
    const theme = scan.files.find(file => file.path === 'src/theme.css')!;
    expect(theme.content).toContain('--token-0: #000000;');
    expect(theme.content).not.toContain('.c1 {');
    // A smaller limit is honoured too.
    expect(bytes(await new GitRepositoryScanner({ maxBytes: 6 * 1024 }).scan(root))).toBeLessThanOrEqual(6 * 1024);
  });

  it('refuses paths with .., relative paths and folders that are not git repositories; validates every listed path', async () => {
    const { root } = repo({ 'package.json': '{}' });
    await expect(scanner.scan(`${root}/../app`)).rejects.toThrow(/«\.\.»/);
    await expect(scanner.scan('app')).rejects.toThrow(/absoluta/);
    const plain = mkdtempSync(join(tmpdir(), 'graphdev2-plain-'));
    roots.push(plain);
    await expect(scanner.scan(plain)).rejects.toThrow(/git/i);
    for (const path of ['../etc/passwd', 'a/../../b', '/etc/passwd', 'a//b', './a', 'a\\b', 'C:/x', ''])
      expect(isSafeRelativePath(path)).toBe(false);
    expect(isSafeRelativePath('src/a.ts')).toBe(true);
  });

  it('an empty repository created by the app has no code', async () => {
    const { root } = repo({ 'README.md': '# x', '.gitignore': 'node_modules/', 'docs/VISION.md': '# v' });
    expect((await scanner.scan(root)).hasCode).toBe(false);
  });

  it('classifies sensitive names and redacts known token formats', () => {
    for (const path of [
      '.env',
      '.env.local',
      'a/.npmrc',
      'x/id_ed25519',
      'k/server.key',
      'k/cert.pem',
      '.aws/credentials',
      'deploy/service-account.json',
      'app/secrets.yml',
      'config/master.key',
    ])
      expect(isSensitivePath(path)).toBe(true);
    for (const path of ['src/tokens.css', 'design-tokens.json', 'package.json', 'src/keyboard.ts', 'src/theme.ts'])
      expect(isSensitivePath(path)).toBe(false);
    expect(redactSecrets('key: sk-abcdefghijklmnopqrstuvwx and ghp_abcdefghijklmnopqrstuvwxyz')).toBe(
      'key: [REDACTADO] and [REDACTADO]',
    );
    expect(redactSecrets('--token-color: #ffffff;')).toBe('--token-color: #ffffff;');
  });
});
