import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionEventLogPort } from '../application/ports/agent-execution-port.js';

export class ExecutionEventLog implements ExecutionEventLogPort {
  constructor(private readonly workspaceRoot: string) {}
  async append(
    projectId: string,
    executionId: string,
    record: {
      id: string;
      sequenceNo: number;
      createdAt: string;
      event: import('../domain/models.js').AgentEvent;
    },
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(projectId) || !/^[a-f0-9-]{36}$/i.test(executionId))
      throw new Error('Identificador de ejecución inválido para el registro JSONL.');
    const directory = join(this.workspaceRoot, 'projects', projectId, 'executions', executionId);
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, 'events.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  }
}
