import { codexCli, resolveCliExecutable } from '../claude-cli/cli-path.js';

export async function resolveCodexExecutable(configured = 'codex'): Promise<string> {
  return resolveCliExecutable(codexCli, configured);
}
