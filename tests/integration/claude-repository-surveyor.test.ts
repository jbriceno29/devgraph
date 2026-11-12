import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeRepositorySurveyor } from '../../src/modules/inception/infrastructure/claude-repository-surveyor.js';
import type { RepositoryScanDto } from '../../src/shared/contracts/repository-scan.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Fake `claude`: logs argv, cwd and the files there, and answers with an inventory. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),finish=v=>process.stdout.write(JSON.stringify(v)+'\\n',()=>process.exit(0));
if(args[0]==='auth'){finish({loggedIn:true});return;}
let stdin='';process.stdin.on('data',c=>stdin+=c);process.stdin.on('end',()=>{
 fs.appendFileSync(path.join(__dirname,'invocations.jsonl'),JSON.stringify({args,cwd:process.cwd(),files:fs.readdirSync(process.cwd()).sort(),stdin})+'\\n');
 finish({type:'result',subtype:'success',is_error:false,result:'',usage:{input_tokens:7,output_tokens:3},structured_output:{modules:[{name:'Núcleo',summary:'x',paths:['src'],capabilities:[]}],entryPoints:[],tests:{description:'',evidence:[]},pending:[]}});
});
`;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });

describe('ClaudeRepositorySurveyor (plan REP, R3)', () => {
  it('reads a throwaway copy of the base branch with Read, Glob and Grep only, without the repository settings, and removes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-surveyor-'));
    roots.push(root);
    const bin = join(root, 'bin'),
      repo = join(root, 'repo'),
      workspace = join(root, 'workspace');
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
    chmodSync(join(bin, 'claude'), 0o755);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'main.ts'), 'export {};\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const commit = git(repo, 'rev-parse', 'HEAD').trim();
    // The user is elsewhere, with uncommitted work: the survey never sees it.
    git(repo, 'checkout', '-q', '-b', 'mi-rama');
    writeFileSync(join(repo, 'src', 'borrador.ts'), 'SIN COMMIT');

    const surveyor = new ClaudeRepositorySurveyor(
      root,
      { workspaceRoot: workspace, repositoryOf: () => repo, configuredBase: () => null },
      { executable: join(bin, 'claude') },
      12,
    );
    const scan = { topLevel: ['src'], directories: [], files: [] } as unknown as RepositoryScanDto;
    const out = await surveyor.survey({ projectId: 'p1', scan, model: 'haiku' });
    expect(out).toMatchObject({ ref: 'main', commit, tracked: ['src/main.ts'], usage: { inputTokens: 7 } });
    expect(out.raw).toMatchObject({ modules: [{ name: 'Núcleo' }] });

    const run = readFileSync(join(bin, 'invocations.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { args: string[]; cwd: string; files: string[]; stdin: string })
      .find(item => item.args[0] === '-p')!;
    const arg = (name: string) => run.args[run.args.indexOf(name) + 1];
    expect(arg('--tools')).toBe('Read,Glob,Grep');
    expect(arg('--allowedTools')).toBe('Read(./**)');
    expect(arg('--permission-mode')).toBe('dontAsk');
    expect(arg('--setting-sources')).toBe('');
    expect(arg('--max-turns')).toBe('12');
    expect(arg('--model')).toBe('haiku');
    expect(run.cwd.startsWith(join(workspace, 'projects', 'p1', 'checks'))).toBe(true);
    expect(run.files).toEqual(['.git', 'src']);
    expect(run.stdin).toContain('at most 12 turns');
    // The copy is gone and the user's branch and work are untouched.
    expect(existsSync(run.cwd)).toBe(false);
    expect(readdirSync(join(workspace, 'projects', 'p1', 'checks'))).toEqual([]);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('mi-rama');
    expect(git(repo, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(join(repo, 'src', 'borrador.ts'), 'utf8')).toBe('SIN COMMIT');
  });
});
