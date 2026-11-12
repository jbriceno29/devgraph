import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkTimeoutMs, timedOutNote } from '../domain/check-timeouts.js';

const execFileAsync = promisify(execFile);

export interface CheckResult {
  command: string;
  exitCode: number;
  output: string;
  /** Plan C6: the check ran out of time (its limit depends on the kind of check). */
  timedOut?: boolean;
  durationMs?: number;
}

/** Runs verification commands one by one in `cwd` (never through a shell), each within its own time limit. */
export async function runChecks(
  cwd: string,
  commands: string[],
  environment?: NodeJS.ProcessEnv,
  timeoutFor: (command: string) => number = checkTimeoutMs,
): Promise<{ results: CheckResult[]; log: string }> {
  const results: CheckResult[] = [];
  for (const command of commands) {
    const argv = parseCommand(command);
    if (!argv.length) throw new Error(`Invalid allowlisted command: ${command}`);
    const timeout = timeoutFor(command),
      started = Date.now();
    try {
      const result = await execFileAsync(argv[0]!, argv.slice(1), {
        cwd,
        encoding: 'utf8',
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        ...(environment ? { env: environment } : {}),
      });
      results.push({ command, exitCode: 0, output: result.stdout + result.stderr, durationMs: Date.now() - started });
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };
      const timedOut = result.killed === true && Date.now() - started >= timeout - 1_000;
      results.push({
        command,
        exitCode: typeof result.code === 'number' ? result.code : 1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}${timedOut ? `\n${timedOutNote(timeout)}` : (result.message ?? '')}`,
        durationMs: Date.now() - started,
        ...(timedOut ? { timedOut } : {}),
      });
    }
  }
  const log = results.length
    ? results.map(result => `$ ${result.command}\n${result.output}\n[exit ${result.exitCode}]`).join('\n\n')
    : 'No verification commands are configured in the autonomy policy.\n';
  return { results, log };
}

export function parseCommand(command: string): string[] {
  if (/[;&|`$<>\n\r]/.test(command))
    throw new Error(`Shell operators are not allowed in verification commands: ${command}`);
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.map(token => token.replace(/^(?:"([^"]*)"|'([^']*)')$/, '$1$2'));
}
