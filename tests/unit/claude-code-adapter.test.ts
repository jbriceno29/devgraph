import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildClaudeArgs,
  buildClaudePermissionArgs,
  claudeAgentEnvironment,
  createClaudeStreamState,
  normalizeClaudeEvent,
} from '../../src/infrastructure/ai/claude-code-adapter.js';
import { buildChildEnvironment } from '../../src/infrastructure/ai/child-environment.js';
import type { AgentEvent } from '../../src/domain/agents/models.js';

const fixtures = join(__dirname, '..', 'fixtures', 'claude');
function replay(name: string, maxTurns?: number): AgentEvent[] {
  const state = createClaudeStreamState('/workspace/repo', maxTurns);
  return readFileSync(join(fixtures, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => normalizeClaudeEvent(JSON.parse(line) as Record<string, unknown>, state));
}
const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
const defaultPolicy = {
  writablePaths: ['src/**', 'tests/**', 'docs/**', 'node_modules/**'],
  readonlyPaths: ['docs/architecture/ADR/**'],
  deniedPaths: ['.env*', '.git/config'],
  allowedCommands: [],
};

describe('normalizeClaudeEvent against real CLI fixtures', () => {
  it('maps a successful edit: session, model, tools, touched file, rate limit and usage', () => {
    const events = replay('edit-file.stream.jsonl');
    expect(events[0]).toMatchObject({ type: 'SESSION_INITIALIZED', model: 'claude-haiku-5-5' });
    expect(ofType(events, 'FILE_TOUCHED')).toEqual([
      expect.objectContaining({ relativePath: 'src/hello.ts', operation: 'CREATE' }),
    ]);
    expect(ofType(events, 'TOOL_INVOCATION_STARTED').map(event => event.toolName)).toEqual(['Bash', 'Write']);
    expect(ofType(events, 'TOOL_INVOCATION_STARTED')[1]!.args).toEqual({ path: 'src/hello.ts' });
    expect(ofType(events, 'ACTION_DENIED')).toEqual([expect.objectContaining({ toolName: 'Bash', reason: 'mode' })]);
    expect(ofType(events, 'RATE_LIMIT_UPDATED')[0]).toMatchObject({
      status: 'allowed',
      window: 'five_hour',
      utilization: 0.1,
    });
    const finished = events.at(-1)!;
    expect(finished.type).toBe('EXECUTION_FINISHED');
    if (finished.type === 'EXECUTION_FINISHED') {
      expect(finished.summary).toContain('hello.ts');
      expect(finished.usage!.outputTokens).toBeGreaterThan(0);
      expect(finished.usage!.inputTokens).toBeGreaterThan(1000);
      expect(finished.usage!.cacheReadTokens).toBe(50204);
      expect(finished.usage!.cacheCreationTokens).toBe(12278);
    }
    expect(events.some(event => event.type === 'TEXT_DELTA')).toBe(true);
  });

  it('reports every denied action with its target and still finishes successfully', () => {
    const events = replay('denied-tools.stream.jsonl');
    const denied = ofType(events, 'ACTION_DENIED');
    expect(denied.map(event => event.toolName)).toEqual(['Bash', 'Bash', 'Write']);
    expect(denied[2]!.target).toBe('README.md');
    expect(denied[0]!.target).toContain('README.md');
    expect(ofType(events, 'FILE_TOUCHED').map(event => event.relativePath)).toEqual(['src/ok.ts']);
    expect(events.at(-1)!.type).toBe('EXECUTION_FINISHED');
  });

  it('turns the SIGINT result into a failed execution with the CLI reason', () => {
    const events = replay('cancel-sigint.stream.jsonl');
    expect(events.at(-1)).toMatchObject({ type: 'EXECUTION_FAILED', errorCode: 'CLAUDE_ABORTED_STREAMING' });
  });

  it('maps the turn limit to CLAUDE_MAX_TURNS with a clear reason and keeps the usage', () => {
    const events = replay('max-turns.stream.jsonl', 1);
    const failed = events.at(-1)!;
    expect(failed).toMatchObject({ type: 'EXECUTION_FAILED', errorCode: 'CLAUDE_MAX_TURNS', isRecoverable: true });
    if (failed.type === 'EXECUTION_FAILED') {
      expect(failed.errorMessage).toContain('tope de 1 turnos');
      expect(failed.usage).toMatchObject({ outputTokens: 124, cacheReadTokens: 4085 });
    }
    // Without the limit in the state, the number comes from the CLI message.
    expect(replay('max-turns.stream.jsonl').at(-1)).toMatchObject({
      errorCode: 'CLAUDE_MAX_TURNS',
      errorMessage: expect.stringContaining('tope de 1 turnos'),
    });
  });

  it('emits nothing terminal for a SIGTERM stream (the adapter decides from the exit code)', () => {
    expect(
      replay('cancel-sigterm.stream.jsonl').filter(
        event => event.type === 'EXECUTION_FINISHED' || event.type === 'EXECUTION_FAILED',
      ),
    ).toEqual([]);
  });

  it('never touches files reported outside the working directory', () => {
    const state = createClaudeStreamState('/workspace/repo');
    normalizeClaudeEvent(
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/etc/passwd' } }] },
      },
      state,
    );
    const events = normalizeClaudeEvent(
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
        tool_use_result: { type: 'update', filePath: '/etc/passwd' },
      },
      state,
    );
    expect(events.map(event => event.type)).toEqual(['TOOL_INVOCATION_FINISHED']);
  });
});

describe('Claude CLI arguments', () => {
  it('translates the default policy into minimal tools, allow and deny rules, and removes Bash', () => {
    const args = buildClaudePermissionArgs(defaultPolicy);
    expect(args).toEqual([
      '--tools',
      'Read,Write,Edit,Glob,Grep',
      '--allowedTools',
      'Write(src/**),Edit(src/**),Write(tests/**),Edit(tests/**),Write(docs/**),Edit(docs/**),Write(node_modules/**),Edit(node_modules/**)',
      '--disallowedTools',
      'Read(**/.env*),Write(**/.env*),Edit(**/.env*),Read(.git/config),Write(.git/config),Edit(.git/config),Write(docs/architecture/ADR/**),Edit(docs/architecture/ADR/**),Bash',
    ]);
  });

  it('exposes Bash only for allowlisted commands and skips commands that would break rule parsing', () => {
    const args = buildClaudePermissionArgs({ ...defaultPolicy, allowedCommands: ['npm test', 'echo a,b'] });
    expect(args[1]).toBe('Read,Write,Edit,Glob,Grep,Bash');
    expect(args[3]).toContain('Bash(npm test),Bash(npm test *)');
    expect(args[3]).not.toContain('echo');
    expect(args[5]!.split(',')).not.toContain('Bash');
  });

  it('runs headless in dontAsk mode without MCP servers and passes the model alias', () => {
    const args = buildClaudeArgs({ model: 'sonnet', policy: defaultPolicy });
    expect(args.slice(0, 9)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
      '--strict-mcp-config',
    ]);
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'sonnet']);
    expect(() => buildClaudeArgs({ model: 'sonnet --dangerously-skip-permissions' })).toThrow(
      'Nombre de modelo inválido',
    );
    expect(buildClaudeArgs({ resumeSessionId: '11111111-1111-4111-8111-111111111111' })).toEqual(
      expect.arrayContaining(['--resume', '11111111-1111-4111-8111-111111111111']),
    );
    expect(() => buildClaudeArgs({ resumeSessionId: 'x; rm -rf /' })).toThrow('Id de sesión inválido');
    expect(buildClaudeArgs({ maxTurns: 40 })).toEqual(expect.arrayContaining(['--max-turns', '40']));
    for (const maxTurns of [undefined, 0])
      expect(buildClaudeArgs(maxTurns === undefined ? {} : { maxTurns })).not.toContain('--max-turns');
    expect(() => buildClaudeArgs({ maxTurns: 1.5 })).toThrow('Tope de turnos inválido');
  });

  it('keeps the user configuration out of every run (settings, CLAUDE.md, skills) without touching HOME', () => {
    for (const args of [
      buildClaudeArgs({}),
      buildClaudeArgs({
        model: 'haiku',
        resumeSessionId: '11111111-1111-4111-8111-111111111111',
        policy: defaultPolicy,
      }),
    ]) {
      expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual([
        '--setting-sources',
        'project,local',
      ]);
      expect(args).toContain('--disable-slash-commands');
      expect(args).not.toContain('--bare');
      expect(args).not.toContain('--no-session-persistence');
    }
    const env = claudeAgentEnvironment(
      { HOME: '/home/u', PATH: '/bin', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', CLAUDECODE: '1' },
      { authMode: 'subscription' },
    );
    expect(env).toEqual({ HOME: '/home/u', PATH: '/bin', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  });
});

describe('buildChildEnvironment', () => {
  const source = {
    HOME: '/home/u',
    PATH: '/bin',
    LANG: 'C.UTF-8',
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_BASE_URL: 'http://proxy',
    ANTHROPIC_AUTH_TOKEN: 't',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'desktop',
    CLAUDE_CODE_OAUTH_TOKEN: 'x',
    SECRET_TOKEN: 'nope',
  };
  it('keeps only allowlisted variables in subscription mode', () => {
    expect(buildChildEnvironment(source, { authMode: 'subscription' })).toEqual({
      HOME: '/home/u',
      PATH: '/bin',
      LANG: 'C.UTF-8',
    });
  });
  it('adds only ANTHROPIC_API_KEY in api_key mode, and requires it', () => {
    expect(buildChildEnvironment(source, { authMode: 'api_key' })).toEqual({
      HOME: '/home/u',
      PATH: '/bin',
      LANG: 'C.UTF-8',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(() => buildChildEnvironment({ HOME: '/h' }, { authMode: 'api_key' })).toThrow('ANTHROPIC_API_KEY');
  });
});
