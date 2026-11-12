import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AgentCapabilities, AgentEvent, ApprovalDecision } from '../domain/models.js';
import type { AgentAdapterPort, AgentRunInput } from '../application/ports/agent-adapter-port.js';
import { buildClaudePermissionArgs } from './claude-permissions.js';

export { buildClaudePermissionArgs };
import { buildChildEnvironment, type AgentAuthMode } from '../../../platform/claude-cli/child-environment.js';
import { claudeCli, resolveCliExecutable } from '../../../platform/claude-cli/cli-path.js';

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
    let child: ChildProcessWithoutNullStreams | undefined;
    let stderr = '';
    let terminalEventSeen = false;
    const state = createClaudeStreamState(input.workingDirectory, input.maxTurns);
    try {
      const executable = await resolveCliExecutable(claudeCli, this.options.executable ?? 'claude');
      const authMode: AgentAuthMode =
        this.options.authMode ?? (input.providerConfig?.authMode === 'api_key' ? 'api_key' : 'subscription');
      const env = claudeAgentEnvironment(process.env, { authMode });
      if (authMode === 'subscription') {
        const auth = await checkClaudeLogin(executable, env, input.workingDirectory);
        if (!auth.loggedIn) {
          yield {
            type: 'EXECUTION_FAILED',
            timestamp: now(),
            errorCode: 'CLAUDE_NOT_AUTHENTICATED',
            errorMessage: auth.message,
            isRecoverable: true,
          };
          return;
        }
      }
      child = spawn(executable, buildClaudeArgs(input), {
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
        child!.once('close', (code, signal) => resolve({ code, signal }));
      });
      const spawnError = new Promise<Error>(resolve => child!.once('error', resolve));
      child.stdin.on('error', error => {
        if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stderr += `\n${error.message}`;
      });
      child.stdin.end(input.prompt);

      for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        for (const event of normalizeClaudeEvent(record, state)) {
          if (event.type === 'EXECUTION_FINISHED' || event.type === 'EXECUTION_FAILED') terminalEventSeen = true;
          yield event;
        }
      }
      // Resolve (not reject) on spawn errors so a late 'error' can never become an unhandled rejection.
      const outcome = await Promise.race([closed, spawnError.then(error => ({ error }))]);
      if ('error' in outcome) throw outcome.error;
      const result = outcome;
      if (!terminalEventSeen) {
        if (result.code === 0 && result.signal === null && !this.cancelled.has(input.executionId)) {
          yield {
            type: 'EXECUTION_FINISHED',
            timestamp: now(),
            summary: state.lastText.trim() || 'Claude Code terminó la ejecución.',
          };
        } else {
          const reason = this.cancelled.has(input.executionId)
            ? 'CLAUDE_CANCELLED'
            : result.signal
              ? `CLAUDE_${result.signal}`
              : 'CLAUDE_EXIT';
          yield {
            type: 'EXECUTION_FAILED',
            timestamp: now(),
            errorCode: reason,
            errorMessage:
              stderr.trim().slice(-4000) || `Claude Code terminó con código ${result.code ?? 'desconocido'}.`,
            isRecoverable: result.signal !== 'SIGKILL',
          };
        }
      }
    } catch (error) {
      yield {
        type: 'EXECUTION_FAILED',
        timestamp: now(),
        errorCode: 'CLAUDE_START_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        isRecoverable: true,
      };
    } finally {
      this.children.delete(input.executionId);
      this.cancelled.delete(input.executionId);
    }
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

export interface ClaudeStreamState {
  workingDirectory: string;
  toolCalls: Map<string, { name: string; input: Record<string, unknown> }>;
  lastText: string;
  maxTurns?: number;
}

export function createClaudeStreamState(workingDirectory: string, maxTurns?: number): ClaudeStreamState {
  return { workingDirectory, toolCalls: new Map(), lastText: '', ...(maxTurns ? { maxTurns } : {}) };
}

/** Maps one `stream-json` record from the Claude Code CLI to domain events. */
export function normalizeClaudeEvent(record: Record<string, unknown>, state: ClaudeStreamState): AgentEvent[] {
  const timestamp = now();
  const type = str(record.type);
  if (type === 'system') {
    const subtype = str(record.subtype);
    if (subtype === 'init') {
      const model = str(record.model);
      return [
        {
          type: 'SESSION_INITIALIZED',
          timestamp,
          externalSessionId: str(record.session_id) || 'unknown',
          ...(model ? { model } : {}),
        },
      ];
    }
    if (subtype === 'permission_denied') {
      const call = state.toolCalls.get(str(record.tool_use_id));
      const toolName = str(record.tool_name) || call?.name || 'unknown';
      return [
        {
          type: 'ACTION_DENIED',
          timestamp,
          toolName,
          target: describeTarget(toolName, call?.input ?? {}, state),
          reason: str(record.decision_reason_type) || 'policy',
        },
      ];
    }
    return [];
  }
  if (type === 'rate_limit_event') {
    const info = obj(record.rate_limit_info);
    const window = str(info.rateLimitType) || 'unknown';
    const current = obj(obj(info.unifiedWindows)[window]);
    const resetsAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : null;
    return [
      {
        type: 'RATE_LIMIT_UPDATED',
        timestamp,
        status: str(info.status) || 'unknown',
        window,
        utilization: typeof current.utilization === 'number' ? current.utilization : null,
        resetsAt,
      },
    ];
  }
  if (type === 'assistant') {
    const events: AgentEvent[] = [];
    for (const block of list(obj(record.message).content)) {
      const blockType = str(block.type);
      if (blockType === 'text') {
        const text = str(block.text);
        if (text.trim()) {
          state.lastText = text;
          events.push({ type: 'TEXT_DELTA', timestamp, delta: text });
        }
      } else if (blockType === 'tool_use') {
        const callId = str(block.id) || `tool:${timestamp}`;
        const toolName = str(block.name) || 'unknown';
        const input = obj(block.input);
        state.toolCalls.set(callId, { name: toolName, input });
        events.push({
          type: 'TOOL_INVOCATION_STARTED',
          timestamp,
          callId,
          toolName,
          args: safeArgs(toolName, input, state),
        });
      }
    }
    return events;
  }
  if (type === 'user') {
    const events: AgentEvent[] = [];
    for (const block of list(obj(record.message).content)) {
      if (str(block.type) !== 'tool_result') continue;
      const callId = str(block.tool_use_id);
      const isError = block.is_error === true;
      events.push({
        type: 'TOOL_INVOCATION_FINISHED',
        timestamp,
        callId,
        resultPreview: toolResultText(block.content).slice(0, 2000),
        isError,
      });
      const call = state.toolCalls.get(callId);
      const result = obj(record.tool_use_result);
      const filePath = str(result.filePath);
      if (!isError && call && ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(call.name) && filePath) {
        const relativePath = toRelative(filePath, state);
        if (relativePath)
          events.push({
            type: 'FILE_TOUCHED',
            timestamp,
            relativePath,
            operation: str(result.type) === 'create' ? 'CREATE' : 'EDIT',
          });
      }
    }
    return events;
  }
  if (type === 'result') {
    const usage = obj(record.usage);
    const tokens = Object.keys(usage).length
      ? {
          inputTokens:
            num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens),
          outputTokens: num(usage.output_tokens),
          // inputTokens includes both: cache reads are cheap, fresh input (incl. cache creation) is what weighs in cost and limits.
          cacheReadTokens: num(usage.cache_read_input_tokens),
          cacheCreationTokens: num(usage.cache_creation_input_tokens),
        }
      : undefined;
    if (record.is_error === true || str(record.subtype) !== 'success') {
      const usageField = tokens ? { usage: tokens } : {};
      const errors = Array.isArray(record.errors)
        ? record.errors.filter((item): item is string => typeof item === 'string')
        : [];
      if (str(record.subtype) === 'error_max_turns' || str(record.terminal_reason) === 'max_turns') {
        const limit = state.maxTurns ?? /\((\d+)\)/.exec(errors.join(' '))?.[1];
        const message = `Se alcanzó el tope de ${limit ?? '?'} turnos por ejecución (política del proyecto) antes de terminar la tarea. En el próximo intento ve directo: lee solo los archivos que vayas a modificar o que cite el contexto, y verifica una sola vez al final.`;
        return [
          {
            type: 'EXECUTION_FAILED',
            timestamp,
            errorCode: 'CLAUDE_MAX_TURNS',
            errorMessage: message,
            isRecoverable: true,
            ...usageField,
          },
        ];
      }
      const code = (str(record.terminal_reason) || str(record.subtype) || 'error').toUpperCase();
      const apiStatus = record.api_error_status;
      const message =
        str(record.result) ||
        errors.join('\n') ||
        (apiStatus !== null && apiStatus !== undefined
          ? `Claude Code recibió un error de la API (${String(apiStatus)}).`
          : `Claude Code terminó con error (${code.toLowerCase()}).`);
      return [
        {
          type: 'EXECUTION_FAILED',
          timestamp,
          errorCode: `CLAUDE_${code}`,
          errorMessage: message,
          isRecoverable: true,
          ...usageField,
        },
      ];
    }
    return [
      {
        type: 'EXECUTION_FINISHED',
        timestamp,
        summary: str(record.result) || state.lastText || 'Claude Code completó la tarea.',
        ...(tokens ? { usage: tokens } : {}),
      },
    ];
  }
  return [];
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

function safeArgs(toolName: string, input: Record<string, unknown>, state: ClaudeStreamState): Record<string, unknown> {
  if (toolName === 'Bash') return { command: str(input.command) };
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName))
    return { path: toRelative(str(input.file_path) || str(input.notebook_path), state) ?? str(input.file_path) };
  if (toolName === 'Glob' || toolName === 'Grep')
    return {
      pattern: str(input.pattern),
      ...(str(input.path) ? { path: toRelative(str(input.path), state) ?? str(input.path) } : {}),
    };
  return toolName === 'WebFetch' ? { url: str(input.url) } : {};
}

function describeTarget(toolName: string, input: Record<string, unknown>, state: ClaudeStreamState): string {
  const args = safeArgs(toolName, input, state);
  return String(args.command ?? args.path ?? args.pattern ?? args.url ?? '');
}

function toRelative(path: string, state: ClaudeStreamState): string | null {
  if (!path) return null;
  if (!isAbsolute(path)) return path.split(sep).join('/');
  const rel = relative(state.workingDirectory, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return list(content)
    .map(block => str(block.text))
    .filter(Boolean)
    .join('\n');
}

function now(): string {
  return new Date().toISOString();
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(obj) : [];
}
