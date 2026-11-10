import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

export async function resolveCodexExecutable(configured = 'codex'): Promise<string> {
  const requested = process.env.GRAPHDEV_CODEX_PATH ?? process.env.CODEX_CLI_PATH ?? configured;
  if (requested.includes('/') || requested.includes('\\')) {
    if (await isExecutable(requested)) return requested;
    throw new Error(`No se pudo iniciar Codex: no existe un ejecutable en "${requested}". Configura GRAPHDEV_CODEX_PATH con la ruta absoluta del CLI.`);
  }
  const fallbackDirectories = process.platform === 'linux'
    ? ['/usr/lib/chatgpt/resources', '/usr/local/bin', '/usr/bin', join(homedir(), '.local', 'bin')]
    : process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
      : [join(process.env.LOCALAPPDATA ?? homedir(), 'Programs', 'Codex', 'bin')];
  for (const directory of [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...fallbackDirectories]) {
    const candidate = join(directory, requested);
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error(`No se encontró el CLI de Codex ("${requested}"). Añade su carpeta al PATH del proceso de escritorio o configura GRAPHDEV_CODEX_PATH con la ruta absoluta; en Linux suele estar en /usr/lib/chatgpt/resources/codex.`);
}

async function isExecutable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}
