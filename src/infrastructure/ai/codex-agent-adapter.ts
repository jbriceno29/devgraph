import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentCapabilities, AgentEvent, ApprovalDecision } from '../../domain/agents/models.js';
import type { AgentAdapterPort, AgentRunInput } from '../../application/ports/agent-adapter-port.js';
import { resolveCodexExecutable } from './codex-cli-path.js';

const capabilities: AgentCapabilities = {
  supportsResume: false,
  supportsStreaming: true,
  supportsApprovals: false,
  supportsCancellation: true,
  supportsStructuredOutput: true,
  supportsWorktrees: true,
};

/** Codex CLI adapter using its documented JSONL event stream. */
export class CodexAgentAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();

  getCapabilities(): AgentCapabilities {
    return { ...capabilities };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const executable = await resolveCodexExecutable();
    const tempDirectory = input.outputSchema ? await mkdtemp(join(tmpdir(), 'graphdev2-codex-schema-')) : null;
    let child: ChildProcessWithoutNullStreams | undefined;
    let stderr = '';
    let lastMessage = '';
    let sessionId = input.executionId;
    let terminalEventSeen = false;
    try {
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--sandbox',
        'workspace-write',
        '--cd',
        input.workingDirectory,
        '--skip-git-repo-check',
      ];
      if (input.model) args.push('--model', input.model);
      if (input.outputSchema && tempDirectory) {
        const schemaPath = join(tempDirectory, 'output-schema.json');
        await writeFile(schemaPath, JSON.stringify(input.outputSchema), 'utf8');
        args.push('--output-schema', schemaPath);
      }
      args.push('-');
      child = spawn(executable, args, {
        cwd: input.workingDirectory,
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
        const emitted = normalizeCodexEvent(record, sessionId);
        for (const event of emitted) {
          if (event.type === 'SESSION_INITIALIZED') sessionId = event.externalSessionId;
          if (event.type === 'TEXT_DELTA') lastMessage += event.delta;
          if (event.type === 'EXECUTION_FINISHED' || event.type === 'EXECUTION_FAILED') terminalEventSeen = true;
          // Codex's turn.completed JSONL record contains usage but usually no
          // final message. Preserve the message emitted by agent_message.
          yield event.type === 'EXECUTION_FINISHED' && lastMessage.trim()
            ? { ...event, summary: lastMessage.trim() }
            : event;
        }
      }
      const result = await closed;
      if (!terminalEventSeen) {
        if (result.code === 0 && result.signal === null) {
          yield {
            type: 'EXECUTION_FINISHED',
            timestamp: new Date().toISOString(),
            summary: lastMessage.trim() || 'Codex terminó la ejecución.',
          };
        } else {
          yield {
            type: 'EXECUTION_FAILED',
            timestamp: new Date().toISOString(),
            errorCode: result.signal ? `CODEX_${result.signal}` : 'CODEX_EXIT',
            errorMessage: stderr.trim().slice(-4000) || `Codex terminó con código ${result.code ?? 'desconocido'}.`,
            isRecoverable: result.signal !== 'SIGKILL',
          };
        }
      }
    } catch (error) {
      yield {
        type: 'EXECUTION_FAILED',
        timestamp: new Date().toISOString(),
        errorCode: 'CODEX_START_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        isRecoverable: true,
      };
    } finally {
      this.children.delete(input.executionId);
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  async cancel(executionId: string): Promise<void> {
    const child = this.children.get(executionId);
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }

  async respondToApproval(_executionId: string, _requestId: string, _decision: ApprovalDecision): Promise<void> {
    throw new Error('Codex CLI no expone aprobaciones interactivas en este adaptador.');
  }
}

export function normalizeCodexEvent(record: Record<string, unknown>, fallbackSessionId: string): AgentEvent[] {
  const timestamp = new Date().toISOString();
  const type = typeof record.type === 'string' ? record.type : '';
  const item = record.item && typeof record.item === 'object' ? (record.item as Record<string, unknown>) : null;
  if (type === 'thread.started') {
    const id = typeof record.thread_id === 'string' ? record.thread_id : fallbackSessionId;
    return [{ type: 'SESSION_INITIALIZED', timestamp, externalSessionId: id }];
  }
  if ((type === 'item.started' || type === 'item.completed') && item) {
    const itemType = typeof item.type === 'string' ? item.type : 'agent_item';
    const callId = typeof item.id === 'string' ? item.id : `${itemType}:${timestamp}`;
    if (type === 'item.started') {
      return [{ type: 'TOOL_INVOCATION_STARTED', timestamp, callId, toolName: itemType, args: safeArgs(item) }];
    }
    if (itemType === 'command_execution') {
      return [
        {
          type: 'TOOL_INVOCATION_FINISHED',
          timestamp,
          callId,
          resultPreview: stringField(item, 'aggregated_output').slice(0, 2000),
          isError: typeof item.exit_code === 'number' && item.exit_code !== 0,
        },
      ];
    }
    if (itemType === 'file_change') return fileTouchedEvents(item, timestamp);
    if (itemType === 'agent_message') {
      const text = stringField(item, 'text');
      return text ? [{ type: 'TEXT_DELTA', timestamp, delta: text }] : [];
    }
  }
  if (type === 'turn.completed') {
    const summary = stringField(record, 'last_agent_message') || 'Codex completó el turno.';
    const usage = record.usage && typeof record.usage === 'object' ? (record.usage as Record<string, unknown>) : null;
    const tokens = usage
      ? {
          inputTokens: numberField(usage, 'input_tokens'),
          outputTokens: numberField(usage, 'output_tokens'),
        }
      : undefined;
    return [{ type: 'EXECUTION_FINISHED', timestamp, summary, ...(tokens ? { usage: tokens } : {}) }];
  }
  if (type === 'turn.failed' || type === 'error') {
    const message = stringField(record, 'message') || stringField(record, 'error') || 'Codex reportó un error.';
    return [
      {
        type: 'EXECUTION_FAILED',
        timestamp,
        errorCode: type === 'error' ? 'CODEX_STREAM_ERROR' : 'CODEX_TURN_FAILED',
        errorMessage: message,
        isRecoverable: true,
      },
    ];
  }
  return [];
}

function fileTouchedEvents(item: Record<string, unknown>, timestamp: string): AgentEvent[] {
  if (!Array.isArray(item.changes)) return [];
  return item.changes.flatMap(change => {
    if (!change || typeof change !== 'object') return [];
    const record = change as Record<string, unknown>;
    const relativePath = stringField(record, 'path');
    const rawOperation = stringField(record, 'kind').toUpperCase();
    const operation =
      rawOperation === 'ADD' || rawOperation === 'CREATE' ? 'CREATE' : rawOperation === 'DELETE' ? 'DELETE' : 'EDIT';
    return relativePath ? [{ type: 'FILE_TOUCHED' as const, timestamp, relativePath, operation }] : [];
  });
}

function safeArgs(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type === 'command_execution') return { command: stringField(item, 'command') };
  return { itemId: stringField(item, 'id') };
}
function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? (record[key] as string) : '';
}
function numberField(record: Record<string, unknown>, key: string): number {
  return typeof record[key] === 'number' ? (record[key] as number) : 0;
}
