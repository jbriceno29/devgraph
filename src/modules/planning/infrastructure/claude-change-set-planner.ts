import { runCli } from './claude-cli-call.js';
import type { ChangeSetDraft, ChangeSetPlannerPort } from '../application/ports/change-set-planning-port.js';
import {
  type PlannerInput,
  buildPlannerPrompt,
  parsePlannerDraft,
  plainSchema,
} from './change-set-planning-contract.js';
import { buildChildEnvironment, type AgentAuthMode } from '../../../platform/claude-cli/child-environment.js';
import { CLAUDE_ISOLATION_ARGS, checkClaudeLogin } from '../../execution/index.js';
import { claudeCli, resolveCliExecutable } from '../../../platform/claude-cli/cli-path.js';

export interface ClaudeChangeSetPlannerOptions {
  executable?: string;
  authMode?: AgentAuthMode;
  /** Alias used when the request does not name a model (provider config `models.planning`). */
  defaultModel?: string | null;
  /** Kept below the host's timeout for `changeset:propose_from_chat` so the user gets this message, not a transport error. */
  timeoutMs?: number;
  /** Time between SIGINT and the SIGTERM fallback when the call is aborted or times out. */
  cancelGraceMs?: number;
}

export interface StructuredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
  model: string | null;
}

export const CLAUDE_PLANNER_TIMEOUT_MS = 300_000;
/** Raised when the caller aborts the call (restart, shutdown); never reported as an engine failure. */
export class EngineCallCancelledError extends Error {
  constructor() {
    super('Llamada al motor cancelada.');
    this.name = 'AbortError';
  }
}
const MODEL_PATTERN = /^[A-Za-z0-9._[\]-]{1,64}$/;

/**
 * Proposes ChangeSets with `claude -p --output-format json --json-schema`.
 * Tools are disabled: the planner works only from the graph and ContextSnapshot in the prompt.
 */
/** Variations of the structured call: the planner and the inception use none (no tools, the planner's folder); the reference translator gives `Read` inside its own folder. */
export interface StructuredCallOptions {
  /** Value of `--tools` (default none). */ tools?: string /** Value of `--allowedTools` (rules that auto-approve calls; with `dontAsk` everything else is denied). */;
  allowedTools?: string /** Working directory of the CLI. */;
  cwd?: string /** What the call does, for error messages (default: propose changes). */;
  purpose?: string /** Time limit of this call in ms (default: the planner's). */;
  timeoutMs?: number;
}

export class ClaudeChangeSetPlanner implements ChangeSetPlannerPort {
  constructor(
    private readonly cwd: string,
    private readonly options: ClaudeChangeSetPlannerOptions = {},
  ) {}

  async propose(input: PlannerInput): Promise<ChangeSetDraft> {
    // Same isolation as the agent runs and the inception: no personal CLI settings, skills or plugins reach the planner.
    const { output } = await this.structured(
      buildPlannerPrompt(input),
      plainSchema,
      input.model,
      CLAUDE_ISOLATION_ARGS,
    );
    return parsePlannerDraft(output, 'Claude Code');
  }

  /**
   * One independent `claude -p` call without tools that must answer with JSON matching `schema`.
   * `extraArgs` go before the model (the inception adds the isolation flags of the agent adapter).
   * `signal` aborts the call: the CLI gets SIGINT, then SIGTERM after the grace period, and the promise rejects with EngineCallCancelledError.
   */
  async structured(
    prompt: string,
    schema: unknown,
    requestedModel?: string,
    extraArgs: readonly string[] = [],
    signal?: AbortSignal,
    options: StructuredCallOptions = {},
  ): Promise<{ output: unknown; usage: StructuredUsage }> {
    const purpose = options.purpose ?? 'proponer cambios';
    if (signal?.aborted) throw new EngineCallCancelledError();
    const executable = await resolveCliExecutable(claudeCli, this.options.executable ?? 'claude');
    const authMode = this.options.authMode ?? 'subscription';
    const env = buildChildEnvironment(process.env, { authMode });
    if (authMode === 'subscription') {
      const auth = await checkClaudeLogin(executable, env, this.cwd);
      if (!auth.loggedIn) throw new Error(auth.message);
    }
    const model = requestedModel ?? this.options.defaultModel ?? undefined;
    if (model && !MODEL_PATTERN.test(model)) throw new Error(`Nombre de modelo inválido: ${model}`);
    const args = structuredArgs(schema, options, extraArgs, model);
    const stdout = await this.run(
      executable,
      args,
      env,
      prompt,
      signal,
      options.cwd ?? this.cwd,
      purpose,
      options.timeoutMs,
    );
    return parseStructured(stdout, purpose, options, model);
  }

  private run(
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    prompt: string,
    abort: AbortSignal | undefined,
    cwd: string,
    purpose: string,
    timeoutOverride?: number,
  ): Promise<string> {
    return runCli({
      executable,
      args,
      env,
      prompt,
      abort,
      cwd,
      purpose,
      timeoutMs: timeoutOverride ?? this.options.timeoutMs ?? CLAUDE_PLANNER_TIMEOUT_MS,
      graceMs: this.options.cancelGraceMs ?? 5_000,
    });
  }
}

function structuredArgs(
  schema: unknown,
  options: StructuredCallOptions,
  extraArgs: readonly string[],
  model: string | undefined,
): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--tools',
    options.tools ?? '',
    ...(options.allowedTools ? ['--allowedTools', options.allowedTools] : []),
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
    ...extraArgs,
    ...(model ? ['--model', model] : []),
  ];
}

/** The CLI's JSON result: its structured output and usage, or the error the CLI reported in Spanish. */
function parseStructured(
  stdout: string,
  purpose: string,
  options: StructuredCallOptions,
  model: string | undefined,
): { output: unknown; usage: StructuredUsage } {
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`Claude Code devolvió una respuesta que no es JSON: ${stdout.slice(0, 300)}`);
  }
  if (result.is_error === true || result.subtype !== 'success') {
    const detail =
      typeof result.result === 'string' && result.result ? result.result : String(result.subtype ?? 'error');
    throw new Error(`Claude Code no pudo ${purpose}: ${detail}`);
  }
  if (result.structured_output === undefined || result.structured_output === null) {
    throw new Error(
      options.purpose
        ? `Claude Code terminó sin un resultado estructurado al ${purpose}. Vuelve a intentarlo o prueba con un modelo más capaz.`
        : 'Claude Code terminó sin una propuesta estructurada. Reformula la petición o prueba con un modelo más capaz.',
    );
  }
  const usage = (result.usage ?? {}) as Record<string, unknown>,
    count = (key: string) => (typeof usage[key] === 'number' ? (usage[key] as number) : 0);
  const used =
    result.modelUsage && typeof result.modelUsage === 'object'
      ? (Object.keys(result.modelUsage as object)[0] ?? null)
      : null;
  return {
    output: result.structured_output,
    usage: {
      inputTokens: count('input_tokens'),
      outputTokens: count('output_tokens'),
      cacheReadTokens: count('cache_read_input_tokens'),
      cacheCreationTokens: count('cache_creation_input_tokens'),
      costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
      model: used ?? model ?? null,
    },
  };
}
