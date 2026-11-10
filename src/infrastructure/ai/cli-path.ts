import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

export interface CliExecutableSpec {
  /** Human name used in error messages, e.g. "Claude Code". */
  displayName: string;
  /** Environment variables that may hold an explicit path, checked in order. */
  envVars: string[];
  /** Extra directories searched after PATH, per platform. */
  fallbackDirectories: Partial<Record<NodeJS.Platform, string[]>>;
  /** Hint appended to the "not found" error. */
  hint: string;
}

/** Resolves an agent CLI: explicit env path, then PATH, then known install directories. */
export async function resolveCliExecutable(spec: CliExecutableSpec, configured: string): Promise<string> {
  const explicit = spec.envVars.map(name => process.env[name]).find(value => value && value.trim());
  const requested = explicit ?? configured;
  const variable = spec.envVars[0] ?? 'PATH';
  if (requested.includes('/') || requested.includes('\\')) {
    if (await isExecutable(requested)) return requested;
    throw new Error(`No se pudo iniciar ${spec.displayName}: no existe un ejecutable en "${requested}". Configura ${variable} con la ruta absoluta del CLI.`);
  }
  const directories = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...(spec.fallbackDirectories[process.platform] ?? [])];
  for (const directory of directories) {
    const candidate = join(directory, requested);
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error(`No se encontró el CLI de ${spec.displayName} ("${requested}"). Añade su carpeta al PATH del proceso de escritorio o configura ${variable} con la ruta absoluta. ${spec.hint}`.trim());
}

export const codexCli: CliExecutableSpec = {
  displayName: 'Codex',
  envVars: ['GRAPHDEV_CODEX_PATH', 'CODEX_CLI_PATH'],
  fallbackDirectories: {
    linux: ['/usr/lib/chatgpt/resources', '/usr/local/bin', '/usr/bin', join(homedir(), '.local', 'bin')],
    darwin: ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')],
    win32: [join(process.env.LOCALAPPDATA ?? homedir(), 'Programs', 'Codex', 'bin')],
  },
  hint: 'En Linux suele estar en /usr/lib/chatgpt/resources/codex.',
};

export const claudeCli: CliExecutableSpec = {
  displayName: 'Claude Code',
  envVars: ['GRAPHDEV_CLAUDE_PATH'],
  fallbackDirectories: {
    linux: [join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local'), '/usr/local/bin', '/usr/bin'],
    darwin: [join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'],
    win32: [join(homedir(), '.local', 'bin'), join(process.env.APPDATA ?? homedir(), 'npm')],
  },
  hint: 'Suele estar en ~/.local/bin/claude.',
};

async function isExecutable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}
