import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeReferenceTranslator } from '../../src/modules/inception/infrastructure/claude-reference-translator.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Fake `claude`: logs argv, cwd, the files in its cwd and stdin; answers for every `ref-<n>` id found in the prompt. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,mode=fs.readFileSync(path.join(dir,'mode'),'utf8').trim(),args=process.argv.slice(2);
const finish=v=>process.stdout.write(JSON.stringify(v)+'\\n',()=>process.exit(0));
if(args[0]==='auth'){finish({loggedIn:true});return;}
let stdin='';process.stdin.on('data',c=>stdin+=c);process.stdin.on('end',()=>{
 fs.appendFileSync(path.join(dir,'invocations.jsonl'),JSON.stringify({args,cwd:process.cwd(),files:fs.readdirSync(process.cwd()).sort(),stdin})+'\\n');
 const base={type:'result',subtype:'success',is_error:false,result:'',session_id:'s',usage:{input_tokens:10,output_tokens:5}};
 const ids=[...new Set([...stdin.matchAll(/"id":"(ref-\\d+)"/g)].map(m=>m[1]))];
 if(mode==='ok')finish({...base,structured_output:{references:ids.map(id=>({id,summary:'Descripción de '+id,palette:['azul'],typography:'',layout:'',screens:['Inicio'],actions:[],flows:[],states:[],ideas:[],openQuestions:[]}))}});
 else if(mode==='api-error')finish({...base,subtype:'error_during_execution',is_error:true,result:'Overloaded'});
 else finish(base);
});
`;
function fakeClaude(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-translator-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'claude');
  writeFileSync(executable, FAKE_CLAUDE);
  chmodSync(executable, 0o755);
  writeFileSync(join(bin, 'mode'), mode);
  const stored = join(root, 'stored');
  mkdirSync(stored);
  const store = (name: string, content: string) => {
    const path = join(stored, name);
    writeFileSync(path, content);
    return path;
  };
  const runs = () =>
    (existsSync(join(bin, 'invocations.jsonl'))
      ? readFileSync(join(bin, 'invocations.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line) as { args: string[]; cwd: string; files: string[]; stdin: string })
      : []
    ).filter(run => run.args[0] === '-p');
  return { root, executable, store, runs, tempRoot: join(root, 'tmp') };
}

describe('ClaudeReferenceTranslator', () => {
  it('runs the CLI with Read only, inside a throwaway folder that holds renamed copies, and deletes it afterwards', async () => {
    const fake = fakeClaude('ok');
    mkdirSync(fake.tempRoot);
    const translator = new ClaudeReferenceTranslator(fake.root, { executable: fake.executable }, fake.tempRoot);
    const { results, usage } = await translator.translate({
      model: 'haiku',
      files: [
        {
          id: 'ref-1',
          kind: 'VISUAL',
          note: 'sin sombras',
          mimeType: 'image/png',
          path: fake.store('ref-1.png', 'png'),
        },
        { id: 'ref-2', kind: 'FUNCTIONAL', note: '', mimeType: 'text/html', path: fake.store('ref-2.HTML', '<html>') },
      ],
    });
    expect(results).toEqual([
      {
        id: 'ref-1',
        error: null,
        translation: expect.objectContaining({ summary: 'Descripción de ref-1', palette: ['azul'], screens: [] }),
      },
      {
        id: 'ref-2',
        error: null,
        translation: expect.objectContaining({ summary: 'Descripción de ref-2', screens: ['Inicio'], palette: [] }),
      },
    ]);
    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    const run = fake.runs()[0]!;
    // Only the Read tool, allowed only below the working folder; no other tool or permission is granted.
    expect(run.args[run.args.indexOf('--tools') + 1]).toBe('Read');
    expect(run.args[run.args.indexOf('--allowedTools') + 1]).toBe('Read(./**)');
    expect(run.args[run.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(run.args[run.args.indexOf('--model') + 1]).toBe('haiku');
    expect(run.args).toContain('--disable-slash-commands');
    expect(run.args[run.args.indexOf('--setting-sources') + 1]).toBe('project,local');
    // The CLI ran in a temporary folder with nothing but the renamed copies, and that folder is gone now.
    expect(run.cwd).toMatch(/graphdev-refs-/);
    expect(run.cwd).not.toBe(fake.root);
    expect(run.files).toEqual(['ref-1.png', 'ref-2.html']);
    expect(existsSync(run.cwd)).toBe(false);
    expect(run.stdin).toContain('"file":"ref-1.png"');
  });

  it('a CLI error rejects with a message that says what the call was doing, and still deletes the folder', async () => {
    const fake = fakeClaude('api-error');
    mkdirSync(fake.tempRoot);
    const translator = new ClaudeReferenceTranslator(fake.root, { executable: fake.executable }, fake.tempRoot);
    await expect(
      translator.translate({
        files: [{ id: 'ref-1', kind: 'VISUAL', note: '', mimeType: 'image/png', path: fake.store('ref-1.png', 'png') }],
      }),
    ).rejects.toThrow('Claude Code no pudo analizar las referencias: Overloaded');
    expect(existsSync(fake.runs()[0]!.cwd)).toBe(false);
  });

  it('an answer without a structured result is reported as such', async () => {
    const fake = fakeClaude('no-output');
    mkdirSync(fake.tempRoot);
    const translator = new ClaudeReferenceTranslator(fake.root, { executable: fake.executable }, fake.tempRoot);
    await expect(
      translator.translate({
        files: [{ id: 'ref-1', kind: 'VISUAL', note: '', mimeType: 'image/png', path: fake.store('ref-1.png', 'png') }],
      }),
    ).rejects.toThrow('sin un resultado estructurado al analizar las referencias');
  });
});
