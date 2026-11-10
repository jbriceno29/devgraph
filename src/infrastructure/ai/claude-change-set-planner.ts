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
}

export const CLAUDE_PLANNER_TIMEOUT_MS = 300_000;
const MODEL_PATTERN = /^[A-Za-z0-9._[\]-]{1,64}$/;

/**
 * Proposes ChangeSets with `claude -p --output-format json --json-schema`.
 * Tools are disabled: the planner works only from the graph and ContextSnapshot in the prompt.
 */
export class ClaudeChangeSetPlanner implements ChangeSetPlannerPort {
  constructor(private readonly cwd: string, private readonly options: ClaudeChangeSetPlannerOptions = {}) {}

  async propose(input: PlannerInput): Promise<ChangeSetDraft> {
    const executable = await resolveCliExecutable(claudeCli, this.options.executable ?? 'claude');
    const authMode = this.options.authMode ?? 'subscription';
    const env = buildChildEnvironment(process.env, { authMode });
    if (authMode === 'subscription') {
      const auth = await checkClaudeLogin(executable, env, this.cwd);
      if (!auth.loggedIn) throw new Error(auth.message);
    }
    const model = input.model ?? this.options.defaultModel ?? undefined;
    if (model && !MODEL_PATTERN.test(model)) throw new Error(`Nombre de modelo inválido: ${model}`);
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(plainSchema), '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence', ...(model ? ['--model', model] : [])];
    const stdout = await this.run(executable, args, env, buildPlannerPrompt(input));
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
    return parsePlannerDraft(result.structured_output, 'Claude Code');
  }

  private run(executable: string, args: string[], env: NodeJS.ProcessEnv, prompt: string): Promise<string> {
    const timeoutMs = this.options.timeoutMs ?? CLAUDE_PLANNER_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let out = '', err = '', timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGINT');
        setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, 5_000).unref();
      }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(new Error(`No se pudo iniciar Claude Code (${executable}): ${error.message}`)); });
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') err += `\n${error.message}`; });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error(`Claude Code superó el límite de ${Math.round(timeoutMs / 1000)} s para proponer cambios.`));
        else if (code === 0) resolve(out.trim());
        else reject(new Error(`Claude Code terminó con ${signal ? `la señal ${signal}` : `código ${code}`}: ${(err || out).slice(-4000)}`));
      });
      child.stdin.end(prompt);
    });
  }
}
