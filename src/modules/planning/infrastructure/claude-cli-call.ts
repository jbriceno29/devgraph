import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EngineCallCancelledError } from './claude-change-set-planner.js';

export interface CliCall {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  prompt: string;
  abort: AbortSignal | undefined;
  cwd: string;
  purpose: string;
  timeoutMs: number;
  graceMs: number;
}

/**
 * One `claude -p` call with the prompt on stdin: resolves with stdout; rejects on a non-zero exit, on the time limit,
 * or with EngineCallCancelledError when `abort` fires (SIGINT first, SIGTERM after the grace period).
 */
export function runCli(call: CliCall): Promise<string> {
  return new Promise((resolve, reject) => {
    if (call.abort?.aborted) {
      reject(new EngineCallCancelledError());
      return;
    }
    const child = spawn(call.executable, call.args, {
      cwd: call.cwd,
      env: call.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output = { out: '', err: '' };
    const control = stopControl(child, call);
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output.out += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', chunk => {
      output.err += chunk;
    });
    child.once('error', error => {
      control.cleanup();
      reject(new Error(`No se pudo iniciar Claude Code (${call.executable}): ${error.message}`));
    });
    child.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') output.err += `\n${error.message}`;
    });
    child.once('close', (code, signal) => {
      control.cleanup();
      if (control.cancelled()) reject(new EngineCallCancelledError());
      else if (control.timedOut())
        reject(
          new Error(`Claude Code superó el límite de ${Math.round(call.timeoutMs / 1000)} s para ${call.purpose}.`),
        );
      else if (code === 0) resolve(output.out.trim());
      else
        reject(
          new Error(
            `Claude Code terminó con ${signal ? `la señal ${signal}` : `código ${code}`}: ${(output.err || output.out).slice(-4000)}`,
          ),
        );
    });
    child.stdin.end(call.prompt);
  });
}

/** Stops the CLI on abort or time limit. SIGINT lets it stop cleanly; the SIGTERM fallback timer stays referenced. */
function stopControl(child: ChildProcessWithoutNullStreams, call: CliCall) {
  let timedOut = false,
    cancelled = false,
    escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null || escalation) return;
    child.kill('SIGINT');
    escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }, call.graceMs);
  };
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  call.abort?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, call.timeoutMs);
  return {
    cancelled: () => cancelled,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      clearTimeout(escalation);
      call.abort?.removeEventListener('abort', onAbort);
    },
  };
}
