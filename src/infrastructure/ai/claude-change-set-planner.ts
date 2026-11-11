import { spawn } from 'node:child_process';
import type { ChangeSetDraft, ChangeSetPlannerPort } from '../../application/ports/change-set-planning-port.js';
import { type PlannerInput, buildPlannerPrompt, parsePlannerDraft, plainSchema } from './change-set-planning-contract.js';
import { buildChildEnvironment, type AgentAuthMode } from './child-environment.js';
import { checkClaudeLogin } from './claude-code-adapter.js';
import { claudeCli, resolveCliExecutable } from './cli-path.js';

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

export interface StructuredUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number | null; model: string | null }

export const CLAUDE_PLANNER_TIMEOUT_MS = 300_000;
/** Raised when the caller aborts the call (restart, shutdown); never reported as an engine failure. */
export class EngineCallCancelledError extends Error { constructor() { super('Llamada al motor cancelada.'); this.name = 'AbortError'; } }
const MODEL_PATTERN = /^[A-Za-z0-9._[\]-]{1,64}$/;

/**
 * Proposes ChangeSets with `claude -p --output-format json --json-schema`.
 * Tools are disabled: the planner works only from the graph and ContextSnapshot in the prompt.
 */
export class ClaudeChangeSetPlanner implements ChangeSetPlannerPort {
  constructor(private readonly cwd: string, private readonly options: ClaudeChangeSetPlannerOptions = {}) {}

  async propose(input: PlannerInput): Promise<ChangeSetDraft> {
    const { output } = await this.structured(buildPlannerPrompt(input), plainSchema, input.model);
    return parsePlannerDraft(output, 'Claude Code');
  }

  /**
   * One independent `claude -p` call without tools that must answer with JSON matching `schema`.
   * `extraArgs` go before the model (the inception adds the isolation flags of the agent adapter).
   * `signal` aborts the call: the CLI gets SIGINT, then SIGTERM after the grace period, and the promise rejects with EngineCallCancelledError.
   */
  async structured(prompt: string, schema: unknown, requestedModel?: string, extraArgs: readonly string[] = [], signal?: AbortSignal): Promise<{ output: unknown; usage: StructuredUsage }> {
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
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence', ...extraArgs, ...(model ? ['--model', model] : [])];
    const stdout = await this.run(executable, args, env, prompt, signal);
    let result: Record<string, unknown>;
    try { result = JSON.parse(stdout) as Record<string, unknown>; }
    catch { throw new Error(`Claude Code devolvió una respuesta que no es JSON: ${stdout.slice(0, 300)}`); }
    if (result.is_error === true || result.subtype !== 'success') {
      const detail = typeof result.result === 'string' && result.result ? result.result : String(result.subtype ?? 'error');
      throw new Error(`Claude Code no pudo proponer cambios: ${detail}`);
    }
    if (result.structured_output === undefined || result.structured_output === null) {
      throw new Error('Claude Code terminó sin una propuesta estructurada. Reformula la petición o prueba con un modelo más capaz.');
    }
    const usage = (result.usage ?? {}) as Record<string, unknown>, count = (key: string) => typeof usage[key] === 'number' ? usage[key] as number : 0;
    const used = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage as object)[0] ?? null : null;
    return { output: result.structured_output, usage: { inputTokens: count('input_tokens'), outputTokens: count('output_tokens'), cacheReadTokens: count('cache_read_input_tokens'), cacheCreationTokens: count('cache_creation_input_tokens'), costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null, model: used ?? model ?? null } };
  }

  private run(executable: string, args: string[], env: NodeJS.ProcessEnv, prompt: string, abort?: AbortSignal): Promise<string> {
    const timeoutMs = this.options.timeoutMs ?? CLAUDE_PLANNER_TIMEOUT_MS, graceMs = this.options.cancelGraceMs ?? 5_000;
    return new Promise((resolve, reject) => {
      if (abort?.aborted) { reject(new EngineCallCancelledError()); return; }
      const child = spawn(executable, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let out = '', err = '', timedOut = false, cancelled = false, escalation: ReturnType<typeof setTimeout> | undefined;
      // SIGINT lets the CLI stop cleanly; SIGTERM is the fallback. The fallback timer stays referenced, so a shutting-down core waits for it.
      const stop = () => {
        if (child.exitCode !== null || child.signalCode !== null || escalation) return;
        child.kill('SIGINT');
        escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, graceMs);
      };
      const onAbort = () => { cancelled = true; stop(); };
      abort?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); clearTimeout(escalation); abort?.removeEventListener('abort', onAbort); };
      child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; });
      child.once('error', error => { cleanup(); reject(new Error(`No se pudo iniciar Claude Code (${executable}): ${error.message}`)); });
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') err += `\n${error.message}`; });
      child.once('close', (code, signal) => {
        cleanup();
        if (cancelled) reject(new EngineCallCancelledError());
        else if (timedOut) reject(new Error(`Claude Code superó el límite de ${Math.round(timeoutMs / 1000)} s para proponer cambios.`));
        else if (code === 0) resolve(out.trim());
        else reject(new Error(`Claude Code terminó con ${signal ? `la señal ${signal}` : `código ${code}`}: ${(err || out).slice(-4000)}`));
      });
      child.stdin.end(prompt);
    });
  }
}
