import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { ReferenceTranslatorPort } from '../../application/ports/inception-port.js';
import { ClaudeChangeSetPlanner, type ClaudeChangeSetPlannerOptions } from './claude-change-set-planner.js';
import { CLAUDE_ISOLATION_ARGS } from './claude-code-adapter.js';
import { buildReferencePrompt, parseReferenceTranslations, referenceTranslationSchema } from './reference-translation-contract.js';

/**
 * Translates reference files into text with `claude -p`. It is the only inception call that has a tool, and the tool is
 * `Read` alone, allowed only inside a throwaway folder that holds renamed copies of the files being translated: reads
 * anywhere else are denied by the CLI's permission mode, no shell and no write tools exist, and the folder is deleted after the call.
 * The file names the user gave never reach the model or the disk path (copies are named `ref-<n>.<extension>`).
 */
export class ClaudeReferenceTranslator implements ReferenceTranslatorPort {
  private readonly runner: ClaudeChangeSetPlanner;
  constructor(cwd: string, options: ClaudeChangeSetPlannerOptions = {}, private readonly tempRoot: string = tmpdir()) { this.runner = new ClaudeChangeSetPlanner(cwd, { timeoutMs: 300_000, ...options }); }

  async translate(input: Parameters<ReferenceTranslatorPort['translate']>[0]) {
    const box = await mkdtemp(join(this.tempRoot, 'graphdev-refs-'));
    try {
      const files = [];
      for (const file of input.files) {
        const name = `${file.id}${extname(file.path).toLowerCase()}`;
        await copyFile(file.path, join(box, name));
        files.push({ id: file.id, kind: file.kind, note: file.note, file: name });
      }
      const { output, usage } = await this.runner.structured(buildReferencePrompt(files), referenceTranslationSchema, input.model, CLAUDE_ISOLATION_ARGS, input.signal, { tools: 'Read', allowedTools: 'Read(./**)', cwd: box, purpose: 'analizar las referencias' });
      return { results: parseReferenceTranslations(output, input.files), usage };
    } finally {
      await rm(box, { recursive: true, force: true });
    }
  }
}
