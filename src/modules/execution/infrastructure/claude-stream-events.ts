import { isAbsolute, relative, sep } from 'node:path';
import type { AgentEvent } from '../domain/models.js';

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
  switch (str(record.type)) {
    case 'system':
      return systemEvents(record, state, timestamp);
    case 'rate_limit_event':
      return [rateLimitEvent(record, timestamp)];
    case 'assistant':
      return assistantEvents(record, state, timestamp);
    case 'user':
      return userEvents(record, state, timestamp);
    case 'result':
      return [resultEvent(record, state, timestamp)];
    default:
      return [];
  }
}

function systemEvents(record: Record<string, unknown>, state: ClaudeStreamState, timestamp: string): AgentEvent[] {
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
  if (subtype !== 'permission_denied') return [];
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

function rateLimitEvent(record: Record<string, unknown>, timestamp: string): AgentEvent {
  const info = obj(record.rate_limit_info);
  const window = str(info.rateLimitType) || 'unknown';
  const current = obj(obj(info.unifiedWindows)[window]);
  const resetsAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : null;
  return {
    type: 'RATE_LIMIT_UPDATED',
    timestamp,
    status: str(info.status) || 'unknown',
    window,
    utilization: typeof current.utilization === 'number' ? current.utilization : null,
    resetsAt,
  };
}

function assistantEvents(record: Record<string, unknown>, state: ClaudeStreamState, timestamp: string): AgentEvent[] {
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

function userEvents(record: Record<string, unknown>, state: ClaudeStreamState, timestamp: string): AgentEvent[] {
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

type Tokens = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

function resultEvent(record: Record<string, unknown>, state: ClaudeStreamState, timestamp: string): AgentEvent {
  const usage = obj(record.usage);
  const tokens: Tokens | undefined = Object.keys(usage).length
    ? {
        inputTokens:
          num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens),
        outputTokens: num(usage.output_tokens),
        // inputTokens includes both: cache reads are cheap, fresh input (incl. cache creation) is what weighs in cost and limits.
        cacheReadTokens: num(usage.cache_read_input_tokens),
        cacheCreationTokens: num(usage.cache_creation_input_tokens),
      }
    : undefined;
  if (record.is_error === true || str(record.subtype) !== 'success')
    return failureEvent(record, state, timestamp, tokens);
  return {
    type: 'EXECUTION_FINISHED',
    timestamp,
    summary: str(record.result) || state.lastText || 'Claude Code completó la tarea.',
    ...(tokens ? { usage: tokens } : {}),
  };
}

/** A run that ended in error: the turn limit is explained (it is the project's policy), anything else keeps its reason. */
function failureEvent(
  record: Record<string, unknown>,
  state: ClaudeStreamState,
  timestamp: string,
  tokens: Tokens | undefined,
): AgentEvent {
  const usageField = tokens ? { usage: tokens } : {};
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((item): item is string => typeof item === 'string')
    : [];
  if (str(record.subtype) === 'error_max_turns' || str(record.terminal_reason) === 'max_turns') {
    const limit = state.maxTurns ?? /\((\d+)\)/.exec(errors.join(' '))?.[1];
    const message = `Se alcanzó el tope de ${limit ?? '?'} turnos por ejecución (política del proyecto) antes de terminar la tarea. En el próximo intento ve directo: lee solo los archivos que vayas a modificar o que cite el contexto, y verifica una sola vez al final.`;
    return {
      type: 'EXECUTION_FAILED',
      timestamp,
      errorCode: 'CLAUDE_MAX_TURNS',
      errorMessage: message,
      isRecoverable: true,
      ...usageField,
    };
  }
  const code = (str(record.terminal_reason) || str(record.subtype) || 'error').toUpperCase();
  const apiStatus = record.api_error_status;
  const message =
    str(record.result) ||
    errors.join('\n') ||
    (apiStatus !== null && apiStatus !== undefined
      ? `Claude Code recibió un error de la API (${String(apiStatus)}).`
      : `Claude Code terminó con error (${code.toLowerCase()}).`);
  return {
    type: 'EXECUTION_FAILED',
    timestamp,
    errorCode: `CLAUDE_${code}`,
    errorMessage: message,
    isRecoverable: true,
    ...usageField,
  };
}

export function safeArgs(
  toolName: string,
  input: Record<string, unknown>,
  state: ClaudeStreamState,
): Record<string, unknown> {
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

export function describeTarget(toolName: string, input: Record<string, unknown>, state: ClaudeStreamState): string {
  const args = safeArgs(toolName, input, state);
  return String(args.command ?? args.path ?? args.pattern ?? args.url ?? '');
}

export function toRelative(path: string, state: ClaudeStreamState): string | null {
  if (!path) return null;
  if (!isAbsolute(path)) return path.split(sep).join('/');
  const rel = relative(state.workingDirectory, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return list(content)
    .map(block => str(block.text))
    .filter(Boolean)
    .join('\n');
}

export function now(): string {
  return new Date().toISOString();
}
export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(obj) : [];
}
