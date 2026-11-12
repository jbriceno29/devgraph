import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { AgentCapabilities, AgentEvent, ApprovalDecision } from '../domain/models.js';
import type { AgentAdapterPort, AgentRunInput } from '../application/ports/agent-adapter-port.js';
import { buildClaudePermissionArgs } from './claude-permissions.js';

export { buildClaudePermissionArgs };
import { buildChildEnvironment, type AgentAuthMode } from '../../../platform/claude-cli/child-environment.js';
import { claudeCli, resolveCliExecutable } from '../../../platform/claude-cli/cli-path.js';
import { type ClaudeStreamState, createClaudeStreamState, normalizeClaudeEvent, now } from './claude-stream-events.js';
export { type ClaudeStreamState, createClaudeStreamState, normalizeClaudeEvent } from './claude-stream-events.js';

const execFileAsync = promisify(execFile);

export const CLAUDE_CODE_CAPABILITIES: AgentCapabilities = {
  supportsResume: true,
  supportsStreaming: true,
  supportsApprovals: false,
  supportsCancellation: true,
  supportsStructuredOutput: true,
  supportsWorktrees: true,
  supportsDocumentationFetch: true,
};

export interface ClaudeCodeAdapterOptions {
  /** Executable name or absolute path; GRAPHDEV_CLAUDE_PATH overrides it. */
  executable?: string;
  authMode?: AgentAuthMode;
  /** Time between SIGINT and the SIGTERM fallback on cancel. */
  cancelGraceMs?: number;
}

const MODEL_PATTERN = /^[A-Za-z0-9._[\]-]{1,64}$/;

/**
 * Claude Code CLI adapter (`claude -p --output-format stream-json`).
 * Field names and behaviours are pinned by the fixtures in tests/fixtures/claude/.
 */
export class ClaudeCodeAdapter implements AgentAdapterPort {
  readonly providerId = 'claude-code' as const;
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly options: ClaudeCodeAdapterOptions = {}) {}

  getCapabilities(): AgentCapabilities {
    return { ...CLAUDE_CODE_CAPABILITIES };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const state = createClaudeStreamState(input.workingDirectory, input.maxTurns);
    try {
      const executable = await resolveCliExecutable(claudeCli, this.options.executable ?? 'claude');
      const authMode: AgentAuthMode =
        this.options.authMode ?? (input.providerConfig?.authMode === 'api_key' ? 'api_key' : 'subscription');
      const env = claudeAgentEnvironment(process.env, { authMode });
      if (authMode === 'subscription') {
        const auth = await checkClaudeLogin(executable, env, input.workingDirectory);
        if (!auth.loggedIn) {
          yield failed('CLAUDE_NOT_AUTHENTICATED', auth.message);
          return;
        }
      }
      const proc = this.spawnClaude(executable, env, input);
      let terminalEventSeen = false;
      for await (const event of readStream(proc.child, state)) {
        if (event.type === 'EXECUTION_FINISHED' || event.type === 'EXECUTION_FAILED') terminalEventSeen = true;
        yield event;
      }
      // Resolve (not reject) on spawn errors so a late 'error' can never become an unhandled rejection.
      const outcome = await Promise.race([proc.closed, proc.spawnError.then(error => ({ error }))]);
      if ('error' in outcome) throw outcome.error;
      if (!terminalEventSeen) yield this.closingEvent(outcome, input, state, proc.stderr());
    } catch (error) {
      yield failed('CLAUDE_START_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.children.delete(input.executionId);
      this.cancelled.delete(input.executionId);
    }
  }

  /** Starts the CLI with the prompt on stdin; stderr is collected for the error message. */
  private spawnClaude(executable: string, env: NodeJS.ProcessEnv, input: AgentRunInput) {
    let stderr = '';
    const child = spawn(executable, buildClaudeArgs(input), {
      cwd: input.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.children.set(input.executionId, child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += String(chunk);
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const spawnError = new Promise<Error>(resolve => child.once('error', resolve));
    child.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stderr += `\n${error.message}`;
    });
    child.stdin.end(input.prompt);
    return { child, closed, spawnError, stderr: () => stderr };
  }

  /** The CLI exited without a result record: a clean exit is a finish, anything else a failure with its stderr. */
  private closingEvent(
    result: { code: number | null; signal: NodeJS.Signals | null },
    input: AgentRunInput,
    state: ClaudeStreamState,
    stderr: string,
  ): AgentEvent {
    const cancelled = this.cancelled.has(input.executionId);
    if (result.code === 0 && result.signal === null && !cancelled)
      return {
        type: 'EXECUTION_FINISHED',
        timestamp: now(),
        summary: state.lastText.trim() || 'Claude Code terminó la ejecución.',
      };
    const reason = cancelled ? 'CLAUDE_CANCELLED' : result.signal ? `CLAUDE_${result.signal}` : 'CLAUDE_EXIT';
    return failed(
      reason,
      stderr.trim().slice(-4000) || `Claude Code terminó con código ${result.code ?? 'desconocido'}.`,
      result.signal !== 'SIGKILL',
    );
  }

  /** SIGINT lets the CLI end the turn and emit its final `result`; SIGTERM is the fallback. */
  async cancel(executionId: string): Promise<void> {
    const child = this.children.get(executionId);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    this.cancelled.add(executionId);
    child.kill('SIGINT');
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }, this.options.cancelGraceMs ?? 5_000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }

  async respondToApproval(_executionId: string, _requestId: string, _decision: ApprovalDecision): Promise<void> {
    throw new Error('El adaptador de Claude Code usa una política estática: no hay aprobaciones interactivas.');
  }
}

/**
 * Keeps the user's personal configuration out of a run: its context comes from the workspace and the branch only.
 * HOME must stay (the subscription session lives there), so the CLI is told not to read the user layer instead:
 * - `--setting-sources project,local`: no ~/.claude/settings.json (user hooks, enabled plugins, env, permissions) and,
 *   in CLI 2.1.x, no ~/.claude/CLAUDE.md nor ~/.claude/rules (the user memory is gated by the userSettings source).
 * - `--disable-slash-commands`: no skills or custom commands (user, plugin or project).
 * Auto-memory is turned off through the environment (CLAUDE_CODE_DISABLE_AUTO_MEMORY, see claudeAgentEnvironment).
 * Not used: `--bare` (ignores OAuth, breaks the subscription), `--safe-mode` (also drops the branch's own CLAUDE.md and
 * hooks; meant for troubleshooting), `--no-session-persistence` (would break `--resume` within a feature).
 * Admin-managed (policy) settings always apply.
 */
export const CLAUDE_ISOLATION_ARGS = ['--setting-sources', 'project,local', '--disable-slash-commands'] as const;

/** Child environment for an agent run: the allowlist plus the switches that keep user-level state out. */
export function claudeAgentEnvironment(
  source: NodeJS.ProcessEnv,
  options: { authMode: AgentAuthMode },
): NodeJS.ProcessEnv {
  return { ...buildChildEnvironment(source, options), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
}

export function buildClaudeArgs(
  input: Pick<AgentRunInput, 'model' | 'policy' | 'resumeSessionId' | 'maxTurns' | 'skills'>,
): string[] {
  // Plan S4: a run that carries app skills keeps the project skills folder (where the app copied them) and gets the Skill tool;
  // `--setting-sources project,local` still keeps the user's personal skills and plugins out (checked with CLI 2.1.318).
  const skills = (input.skills ?? []).filter(id => /^[a-z0-9-]+$/.test(id));
  const isolation = skills.length
    ? CLAUDE_ISOLATION_ARGS.filter(arg => arg !== '--disable-slash-commands')
    : CLAUDE_ISOLATION_ARGS;
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    ...isolation,
  ];
  if (input.model) {
    if (!MODEL_PATTERN.test(input.model)) throw new Error(`Nombre de modelo inválido: ${input.model}`);
    args.push('--model', input.model);
  }
  if (input.resumeSessionId) {
    if (!/^[0-9a-f-]{36}$/i.test(input.resumeSessionId))
      throw new Error(`Id de sesión inválido: ${input.resumeSessionId}`);
    args.push('--resume', input.resumeSessionId);
  }
  // Hidden flag in CLI 2.1.x (not in --help): past the limit the run ends with subtype `error_max_turns` and exit 1.
  if (input.maxTurns !== undefined && input.maxTurns > 0) {
    if (!Number.isInteger(input.maxTurns)) throw new Error(`Tope de turnos inválido: ${input.maxTurns}`);
    args.push('--max-turns', String(input.maxTurns));
  }
  const permissions = buildClaudePermissionArgs(
    input.policy ?? { writablePaths: [], readonlyPaths: [], deniedPaths: [], allowedCommands: [] },
  );
  const tools = permissions.indexOf('--tools');
  if (skills.length && tools >= 0) permissions[tools + 1] = `${permissions[tools + 1]},Skill`;
  args.push(...permissions);
  return args;
}

export async function checkClaudeLogin(
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ loggedIn: boolean; message: string }> {
  try {
    const { stdout } = await execFileAsync(executable, ['auth', 'status', '--json'], {
      cwd,
      env,
      timeout: 15_000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const status = JSON.parse(stdout) as { loggedIn?: unknown };
    return status.loggedIn === true
      ? { loggedIn: true, message: '' }
      : {
          loggedIn: false,
          message:
            'Claude Code no tiene una sesión iniciada. Ejecuta `claude` en una terminal e inicia sesión con tu suscripción.',
        };
  } catch (error) {
    return {
      loggedIn: false,
      message: `No se pudo comprobar la sesión de Claude Code: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The CLI's stream-json lines as domain events (lines that are not JSON are skipped). */
async function* readStream(child: ChildProcessWithoutNullStreams, state: ClaudeStreamState): AsyncIterable<AgentEvent> {
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    yield* normalizeClaudeEvent(record, state);
  }
}

function failed(errorCode: string, errorMessage: string, isRecoverable = true): AgentEvent {
  return { type: 'EXECUTION_FAILED', timestamp: now(), errorCode, errorMessage, isRecoverable };
}
