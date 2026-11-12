import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexExecutable } from '../../../platform/codex-cli/codex-cli-path.js';
import {
  type PlannerInput,
  buildPlannerPrompt,
  parsePlannerDraft,
  strictNullableSchema,
} from './change-set-planning-contract.js';
import type { ChangeSetDraft, ChangeSetPlannerPort } from '../application/ports/change-set-planning-port.js';

export class CodexChangeSetPlanner implements ChangeSetPlannerPort {
  constructor(
    private readonly cwd: string,
    private readonly executable = 'codex',
    private readonly timeoutMs = 120_000,
  ) {}
  async propose(input: PlannerInput): Promise<ChangeSetDraft> {
    const dir = await mkdtemp(join(tmpdir(), 'graphdev2-codex-')),
      schemaPath = join(dir, 'schema.json'),
      outputPath = join(dir, 'response.json');
    try {
      await writeFile(schemaPath, JSON.stringify(strictNullableSchema));
      const prompt = buildPlannerPrompt(input);
      const stdout = await this.run(
        [
          '-s',
          'read-only',
          '-a',
          'never',
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          '--color',
          'never',
          '-C',
          this.cwd,
          '-',
        ],
        prompt,
      );
      let response = '';
      try {
        response = await readFile(outputPath, 'utf8');
      } catch {
        response = stdout.trim();
      }
      return parsePlannerDraft(JSON.parse(response) as unknown, 'Codex');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  private async run(args: string[], prompt: string): Promise<string> {
    const executable = await resolveCodexExecutable(this.executable);
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let out = '',
        err = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Codex superó el límite de tiempo para proponer cambios.'));
      }, this.timeoutMs);
      child.stdout.setEncoding('utf8').on('data', chunk => (out += chunk));
      child.stderr.setEncoding('utf8').on('data', chunk => (err += chunk));
      child.once('error', error => {
        clearTimeout(timer);
        reject(new Error(`No se pudo iniciar Codex (${executable}): ${error.message}`));
      });
      child.stdin.on('error', error => {
        if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
          clearTimeout(timer);
          child.kill('SIGTERM');
          reject(new Error(`No se pudo enviar el contexto a Codex: ${error.message}`));
        }
      });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`Codex terminó con código ${code}: ${err.slice(-4000)}`));
      });
      child.stdin.end(prompt);
    });
  }
}
