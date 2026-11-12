#!/usr/bin/env node
/**
 * Stage 5 benchmark: the same feature solved two ways, from the same commit, with the same model and permissions.
 *
 *   chat       one Claude Code conversation (`claude -p --resume`), tasks sent in order, as a person would by chat.
 *   workspace  Graph Workspace's autopilot on a copy of the project: curated context per task, memory between tasks,
 *              gates and retries.
 *
 * Each arm's final code is judged by hidden tests the agents never see (scripts/benchmark/todo/hidden).
 *
 * Usage (build the core first: npm run build:core):
 *   node scripts/benchmark/run-todo-benchmark.mjs --base <todo-app repo> --ref <commit-ish> \
 *     --workspace <app data dir> --project <project id> [--model haiku] [--out <dir>] [--report <file.md>]
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BENCH = join(ROOT, 'scripts', 'benchmark', 'todo');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs),
      [],
    ),
);
for (const required of ['base', 'ref', 'workspace', 'project'])
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(2);
  }
const model = args.model ?? 'haiku';
const out = resolve(args.out ?? mkdtempSync(join(tmpdir(), 'graphdev2-bench-')));
const spec = JSON.parse(readFileSync(join(BENCH, 'tasks.json'), 'utf8'));
const policy = {
  writablePaths: ['src/**', 'tests/**'],
  readonlyPaths: [],
  deniedPaths: ['.env*'],
  allowedCommands: ['node --test'],
};
const { buildClaudePermissionArgs } = await import(join(ROOT, 'dist/main/infrastructure/ai/claude-code-adapter.js'));
const { buildChildEnvironment } = await import(join(ROOT, 'dist/main/infrastructure/ai/child-environment.js'));
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

function cloneBase(target) {
  execFileSync('git', ['clone', '--quiet', args.base, target]);
  execFileSync('git', ['checkout', '--quiet', '-B', 'main', args.ref], { cwd: target });
  execFileSync('git', ['config', 'user.name', 'Graph Bench'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 'bench@graphdev.local'], { cwd: target });
}

function taskPrompt(task) {
  return `Tarea ${task.key}: ${task.title}\n\n${task.summary}\n\nCriterios de aceptación:\n${task.criteria.map(item => `- ${item}`).join('\n')}\n\nTrabaja en este repositorio (ESM, sin dependencias). Añade o ajusta pruebas en tests/ y ejecuta node --test antes de terminar.`;
}

/** Runs the hidden tests of each task against `ref` of `repo`; returns { [taskId]: { pass, fail } }. */
function judge(repo, ref) {
  const dir = mkdtempSync(join(out, 'judge-'));
  execFileSync('git', ['worktree', 'add', '--quiet', '--detach', dir, ref], { cwd: repo });
  cpSync(join(BENCH, 'hidden'), join(dir, '.bench-hidden'), { recursive: true });
  const results = {};
  for (const file of readdirSync(join(dir, '.bench-hidden')).sort()) {
    const id = file.slice(0, 2).toUpperCase();
    const run = spawnSync('node', ['--test', '--test-reporter=tap', join('.bench-hidden', file)], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const count = name => Number(new RegExp(`^# ${name} (\\d+)`, 'm').exec(run.stdout)?.[1] ?? 0);
    results[id] = { pass: count('pass'), fail: count('fail') + (run.status !== 0 && count('fail') === 0 ? 1 : 0) };
  }
  execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo });
  return results;
}

async function chatArm() {
  const repo = join(out, 'chat-repo');
  cloneBase(repo);
  const env = buildChildEnvironment(process.env, { authMode: 'subscription' });
  const rows = [];
  let session = null;
  for (const task of spec.tasks) {
    const commandArgs = [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
      '--strict-mcp-config',
      '--model',
      model,
      ...buildClaudePermissionArgs(policy),
      ...(session ? ['--resume', session] : []),
    ];
    const started = Date.now();
    const run = spawnSync('claude', commandArgs, {
      cwd: repo,
      input: taskPrompt(task),
      env,
      encoding: 'utf8',
      timeout: 15 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    let result = {};
    try {
      result = JSON.parse(run.stdout);
    } catch {
      result = { is_error: true, result: run.stderr?.slice(-500) };
    }
    session = result.session_id ?? session;
    const usage = result.usage ?? {};
    const own = spawnSync('node', ['--test'], { cwd: repo, encoding: 'utf8', timeout: 120_000 });
    execFileSync('git', ['add', '-A'], { cwd: repo });
    spawnSync('git', ['commit', '--quiet', '--allow-empty', '-m', `${task.key}: ${task.title}`], { cwd: repo });
    const row = {
      id: task.id,
      key: task.key,
      ok: result.is_error !== true,
      inputTokens:
        (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens ?? 0,
      durationMs: Date.now() - started,
      denied: result.permission_denials?.length ?? 0,
      ownTestsPass: own.status === 0,
    };
    rows.push(row);
    log('chat', task.key, JSON.stringify(row));
  }
  return { repo, ref: 'HEAD', rows, hidden: judge(repo, 'HEAD') };
}

async function workspaceArm() {
  const { createWorkspaceCore } = await import(join(ROOT, 'dist/main/infrastructure/ipc/sidecar/workspace-core.js'));
  const { openDatabase, closeDatabase } = await import(
    join(ROOT, 'dist/main/infrastructure/persistence/sqlite/database.js')
  );
  const repo = join(out, 'workspace-repo');
  cloneBase(repo);
  const workspaceRoot = join(out, 'workspace');
  mkdirSync(join(workspaceRoot, 'projects', args.project), { recursive: true });
  const source = openDatabase({
    filename: join(args.workspace, 'projects', args.project, 'workspace.sqlite'),
    readonly: true,
  });
  await source.backup(join(workspaceRoot, 'projects', args.project, 'workspace.sqlite'));
  closeDatabase(source);
  const core = createWorkspaceCore(workspaceRoot, () => undefined);
  const h = (channel, ...rest) => core.handle({ channel, args: rest });
  const P = args.project;
  const opened = await h('project:open', P);
  await h('repository:configure', P, repo);
  await h('policy:update', P, { ...policy, maxExecutionMinutes: 15 });
  const moduleId = opened.graph.nodes.find(node => node.type === 'MODULE')?.id;
  const db = openDatabase({ filename: join(workspaceRoot, 'projects', P, 'workspace.sqlite'), initialize: false });
  const ids = Object.fromEntries(spec.tasks.map(task => [task.id, `bench-${task.id.toLowerCase()}`]));
  try {
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    insert.run(
      'bench-feature',
      P,
      'FEATURE',
      spec.feature.key,
      spec.feature.title,
      spec.feature.summary,
      'DRAFT',
      moduleId,
    );
    db.prepare(`INSERT INTO features(entity_id,scope,priority) VALUES('bench-feature',?, 'HIGH')`).run(
      spec.feature.summary,
    );
    for (const task of spec.tasks) {
      insert.run(
        ids[task.id],
        P,
        'WORK_ITEM',
        task.key,
        task.title,
        task.summary,
        task.dependsOn.length ? 'BLOCKED' : 'READY',
        'bench-feature',
      );
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH',?,'DEVELOPER')`,
      ).run(ids[task.id], JSON.stringify(task.criteria));
      for (const dependency of task.dependsOn)
        db.prepare(
          `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
        ).run(`bench-${task.id}-${dependency}`, P, ids[task.id], ids[dependency]);
    }
  } finally {
    closeDatabase(db);
  }
  await h('pilot:set_autonomy', P, 'bench-feature', {
    level: 'PILOT',
    executionModel: model,
    maxAttempts: 2,
    usagePauseThreshold: 0.99,
  });
  await h('pilot:start', P, 'bench-feature', { acknowledgeCost: true });
  let state,
    seen = 0;
  for (;;) {
    state = await h('pilot:get', P, 'bench-feature');
    for (const event of state.events.slice(seen)) log('workspace', event.kind, event.message);
    seen = state.events.length;
    if (state.run.status !== 'RUNNING') break;
    await new Promise(done => setTimeout(done, 2000));
  }
  const { report } = await h('metrics:feature_report', P, 'bench-feature');
  const branch =
    (await h('execution:list', P)).find(execution => execution.baseBranch?.startsWith('feature/'))?.baseBranch ??
    'main';
  core.close();
  const rows = spec.tasks.map(task => {
    const metrics = report.tasks.find(item => item.displayKey === task.key);
    const executions = metrics?.executions ?? [];
    return {
      id: task.id,
      key: task.key,
      ok: metrics?.status === 'DONE',
      attempts: executions.length,
      inputTokens: executions.reduce((total, item) => total + item.inputTokens, 0),
      outputTokens: executions.reduce((total, item) => total + item.outputTokens, 0),
      durationMs: executions.reduce((total, item) => total + (item.durationMs ?? 0), 0),
      denied: executions.reduce((total, item) => total + item.deniedActions, 0),
      ownTestsPass: executions.at(-1)?.checksPassed ?? false,
      status: metrics?.status,
    };
  });
  return {
    repo,
    ref: branch,
    rows,
    hidden: judge(repo, branch),
    pilot: { status: state.run.status, reason: state.run.reason },
    totals: report.totals,
  };
}

log('output', out);
const chat = await chatArm();
const workspace = await workspaceArm();
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const hiddenTotal = hidden =>
  Object.values(hidden).reduce((total, item) => ({ pass: total.pass + item.pass, fail: total.fail + item.fail }), {
    pass: 0,
    fail: 0,
  });
const tasksFullyPassing = hidden => Object.values(hidden).filter(item => item.fail === 0 && item.pass > 0).length;
const k = value => value.toLocaleString('es');
const min = ms => `${(ms / 60_000).toFixed(1)} min`;
const lines = [
  `# Benchmark Etapa 5: ${spec.feature.title} (todo-app)`,
  '',
  `Fecha: ${new Date().toISOString().slice(0, 10)} · Modelo: ${model} · Base: \`${args.ref}\``,
  '',
  'Mismas 5 tareas, mismo commit de partida, mismo modelo y permisos. Juez: pruebas ocultas que ningún agente ve.',
  '',
  '| | Chat (una conversación) | Graph Workspace (piloto) |',
  '| :--- | ---: | ---: |',
  `| Tareas que pasan todas sus pruebas ocultas | ${tasksFullyPassing(chat.hidden)} de ${spec.tasks.length} | ${tasksFullyPassing(workspace.hidden)} de ${spec.tasks.length} |`,
  `| Pruebas ocultas (pasan / fallan) | ${hiddenTotal(chat.hidden).pass} / ${hiddenTotal(chat.hidden).fail} | ${hiddenTotal(workspace.hidden).pass} / ${hiddenTotal(workspace.hidden).fail} |`,
  `| Tokens de entrada | ${k(sum(chat.rows, 'inputTokens'))} | ${k(sum(workspace.rows, 'inputTokens'))} |`,
  `| Tokens de salida | ${k(sum(chat.rows, 'outputTokens'))} | ${k(sum(workspace.rows, 'outputTokens'))} |`,
  `| Tiempo del motor | ${min(sum(chat.rows, 'durationMs'))} | ${min(sum(workspace.rows, 'durationMs'))} |`,
  `| Ejecuciones | ${chat.rows.length} | ${sum(workspace.rows, 'attempts')} |`,
  `| Acciones denegadas | ${sum(chat.rows, 'denied')} | ${sum(workspace.rows, 'denied')} |`,
  `| Mensajes que tuvo que escribir la persona | ${chat.rows.length} | 0 (piloto: ${workspace.pilot.status}) |`,
  '',
  '| Tarea | Chat: tokens entrada / salida | Chat: ocultas | Workspace: intentos | Workspace: tokens entrada / salida | Workspace: ocultas |',
  '| :--- | ---: | ---: | ---: | ---: | ---: |',
  ...spec.tasks.map(task => {
    const c = chat.rows.find(row => row.id === task.id),
      w = workspace.rows.find(row => row.id === task.id);
    const hc = chat.hidden[task.id] ?? { pass: 0, fail: 0 },
      hw = workspace.hidden[task.id] ?? { pass: 0, fail: 0 };
    return `| ${task.key} ${task.title} | ${k(c.inputTokens)} / ${k(c.outputTokens)} | ${hc.pass}/${hc.pass + hc.fail} | ${w.attempts} | ${k(w.inputTokens)} / ${k(w.outputTokens)} | ${hw.pass}/${hw.pass + hw.fail} |`;
  }),
  '',
  `Piloto: ${workspace.pilot.status}${workspace.pilot.reason ? ` · ${workspace.pilot.reason}` : ''}`,
  '',
  'Notas: los tokens de entrada incluyen los leídos de caché. El brazo chat no tiene reintentos; el piloto tiene hasta 2 intentos por tarea y solo acepta con `node --test` en verde.',
];
const markdown = `${lines.join('\n')}\n`;
writeFileSync(join(out, 'report.md'), markdown);
writeFileSync(join(out, 'raw.json'), JSON.stringify({ chat, workspace }, null, 2));
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(resolve(args.report), markdown);
}
console.log(`\n${markdown}`);
