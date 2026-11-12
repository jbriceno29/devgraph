/**
 * Builds the environment for an agent CLI child process from an allowlist instead of inheriting it.
 *
 * Inheriting would leak variables that silently change how the CLI authenticates or behaves: an
 * `ANTHROPIC_API_KEY` bills the API instead of the subscription, and when Graph Workspace itself
 * runs under another Claude session, `ANTHROPIC_BASE_URL`, `CLAUDECODE` and `CLAUDE_CODE_*`
 * redirect authentication or switch the CLI into a nested mode.
 */
const ALLOWED = [
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TERM',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Windows
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'HOMEDRIVE',
  'HOMEPATH',
] as const;

export type AgentAuthMode = 'subscription' | 'api_key';

export function buildChildEnvironment(
  source: NodeJS.ProcessEnv,
  options: { authMode: AgentAuthMode },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ALLOWED) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  if (options.authMode === 'api_key') {
    const key = source.ANTHROPIC_API_KEY;
    if (!key) throw new Error('El modo de autenticación es api_key, pero ANTHROPIC_API_KEY no está definida.');
    env.ANTHROPIC_API_KEY = key;
  }
  return env;
}
