import { describe, expect, it } from 'vitest';
import { normalizeCodexEvent } from '../../src/infrastructure/ai/codex-agent-adapter.js';

describe('Codex JSONL event normalization', () => {
  it('maps thread and assistant message events into domain events', () => {
    expect(normalizeCodexEvent({ type: 'thread.started', thread_id: 'thread-1' }, 'fallback')).toMatchObject([
      { type: 'SESSION_INITIALIZED', externalSessionId: 'thread-1' },
    ]);
    expect(
      normalizeCodexEvent(
        { type: 'item.completed', item: { type: 'agent_message', text: 'Implemented the feature.' } },
        'thread-1',
      ),
    ).toMatchObject([{ type: 'TEXT_DELTA', delta: 'Implemented the feature.' }]);
  });

  it('maps a completed turn and preserves usage details', () => {
    expect(
      normalizeCodexEvent({ type: 'turn.completed', usage: { input_tokens: 25, output_tokens: 8 } }, 'thread-1'),
    ).toMatchObject([{ type: 'EXECUTION_FINISHED', usage: { inputTokens: 25, outputTokens: 8 } }]);
  });

  it('maps failed commands and file changes', () => {
    expect(
      normalizeCodexEvent(
        {
          type: 'item.completed',
          item: { type: 'command_execution', id: 'cmd-1', exit_code: 2, aggregated_output: 'failed' },
        },
        'thread-1',
      ),
    ).toMatchObject([{ type: 'TOOL_INVOCATION_FINISHED', callId: 'cmd-1', isError: true }]);
    expect(
      normalizeCodexEvent(
        { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/main.ts', kind: 'add' }] } },
        'thread-1',
      ),
    ).toMatchObject([{ type: 'FILE_TOUCHED', relativePath: 'src/main.ts', operation: 'CREATE' }]);
  });
});
