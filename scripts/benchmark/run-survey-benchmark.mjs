#!/usr/bin/env node
/**
 * Plan REP, R3 benchmark: does the map of what exists help the agents of an existing repository?
 *
 * Both arms start from the same commit of the scenario's base, with the same tasks (one feature per task, under a
 * module named after the area), model, policy and pilot. The only difference:
 *   sin-mapa  the plan alone (as before R3).
 *   con-mapa  plus the map from a real read-only survey (haiku), applied with the app's own ChangeSet applier: modules
 *             with their capabilities done or partial, CODE_REFERENCE + TOUCHES_CODE to their files, and
 *             docs/MAPA_DEL_CODIGO.md. Each task's feature hangs on the map module that covers its area.
 *
 * Measures per task: accepted on the first attempt, tool calls before the first change (exploration), whether the work
 * reuses the existing code instead of duplicating or contradicting it (scenario "reuse" checks on the final code),
 * tokens, and the hidden tests.
 *
 * Usage (npm run build:core first):
 *   node scripts/benchmark/run-survey-benchmark.mjs [--scenario tienda-existente] [--model haiku] [--out <dir>] [--report <file.md>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const name = args.scenario ?? 'tienda-existente';
const SCENARIO = join(ROOT, 'scripts', 'benchmark', name);
const spec = JSON.parse(readFileSync(join(SCENARIO, 'scenario.json'), 'utf8'));
const model = args.model ?? 'haiku';
const out = resolve(args.out ?? mkdtempSync(join(tmpdir(), `graphdev2-${name}-`)));
mkdirSync(out, { recursive: true });
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, encoding: 'utf8' }).trim();
const dist = path => import(join(ROOT, 'dist/main', path));

/** The scenario's base as a repository with one commit on main. */
function baseRepository() {
  const repo = join(out, 'base');
  if (existsSync(repo)) return repo;
  cpSync(join(SCENARIO, 'base'), repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  execFileSync('git', ['-c', 'user.name=Bench', '-c', 'user.email=b@b', 'commit', '-qm', 'tienda existente'], {
    cwd: repo,
  });
  return repo;
}

/** One real survey of the base (the same map for the arm that uses it). */
async function survey(base) {
  const { ClaudeRepositorySurveyor } = await dist('modules/inception/infrastructure/claude-repository-surveyor.js');
  const { GitRepositoryScanner } = await dist('modules/projects/infrastructure/repository-scanner.js');
  const { normalizeSurvey } = await dist('modules/inception/application/repository-survey.js');
  const started = Date.now();
  const surveyor = new ClaudeRepositorySurveyor(out, {
    workspaceRoot: join(out, 'survey'),
    repositoryOf: () => base,
    configuredBase: () => null,
  });
  const result = await surveyor.survey({
    projectId: 'survey',
    scan: await new GitRepositoryScanner().scan(base),
    model,
  });
  const map = normalizeSurvey(result.raw, result.tracked, result);
  writeFileSync(join(out, 'map.json'), JSON.stringify({ map, usage: result.usage, ms: Date.now() - started }, null, 2));
  log('survey', `${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(result.usage));
  return { map, usage: result.usage, ms: Date.now() - started };
}

/** Seeds the arm's plan: per task a module (the map's when there is one), a feature and the task, READY. */
async function seed(db, P, rootId, repo, map) {
  const { surveyOperations, mapModuleId } = await dist('modules/inception/application/survey-plan.js');
  const { SqliteChangeSetApplier } = await dist('modules/knowledge/infrastructure/sqlite-change-set-applier.js');
  const { TransactionalMarkdownFileStore } = await dist(
    'modules/documents/infrastructure/transactional-markdown-file-store.js',
  );
  const { GitDocumentCommitter } = await dist('modules/documents/infrastructure/git-document-committer.js');
  const moduleFor = task => {
    const index = map
      ? map.modules.findIndex(module =>
          module.paths.some(
            path => path === task.area || task.area.startsWith(`${path}/`) || path.startsWith(`${task.area}/`),
          ),
        )
      : -1;
    return index >= 0 ? mapModuleId(index) : `$mod_${task.id}`;
  };
  const operations = map ? surveyOperations(map, rootId) : [];
  for (const task of spec.tasks) {
    const moduleId = moduleFor(task);
    if (!moduleId.startsWith('$map_'))
      operations.push({
        type: 'CREATE_MODULE',
        tempId: moduleId,
        parentId: rootId,
        title: task.area.split('/').pop(),
        summary: '',
        purpose: task.area,
      });
    operations.push(
      {
        type: 'CREATE_FEATURE',
        tempId: `$f_${task.id}`,
        moduleId,
        title: task.title,
        summary: task.summary,
        scope: task.summary,
        priority: 'HIGH',
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: `$t_${task.id}`,
        parentId: `$f_${task.id}`,
        workType: 'TASK',
        priority: 'HIGH',
        title: task.title,
        summary: task.summary,
        acceptanceCriteria: task.criteria,
        recommendedProfileRole: 'DEVELOPER',
      },
      { type: 'UPDATE_ENTITY_STATUS', entityId: `$t_${task.id}`, newStatus: 'READY', reason: 'benchmark' },
    );
  }
  const revision = db.prepare('SELECT current_revision FROM projects WHERE id=?').get(P).current_revision;
  const repository = db.prepare('SELECT * FROM repositories WHERE project_id=?').get(P);
  const applier = new SqliteChangeSetApplier(
    db,
    new TransactionalMarkdownFileStore(),
    { findPrimaryForProject: () => ({ id: repository.id }) },
    new GitDocumentCommitter(),
  );
  const changeSet = {
    id: `bench-${Date.now()}`,
    projectId: P,
    baseGraphRevision: revision,
    originType: 'USER_BULK_ACTION',
    title: 'Benchmark R3',
    rationale: '',
    status: 'VALIDATED',
    operations,
    validationIssues: [],
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO change_sets(id,project_id,base_graph_revision,origin_type,title,rationale,status,operations_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    changeSet.id,
    P,
    revision,
    changeSet.originType,
    changeSet.title,
    '',
    'VALIDATED',
    JSON.stringify(operations),
    changeSet.createdAt,
  );
  const { resolvedIds } = await applier.apply(changeSet, repo);
  return Object.fromEntries(
    spec.tasks.map(task => [task.id, { feature: resolvedIds[`$f_${task.id}`], task: resolvedIds[`$t_${task.id}`] }]),
  );
}

/** Tool calls before the first Edit or Write of each execution of a task, from its event log. */
function exploration(workspaceRoot, P, executionId) {
  const file = join(workspaceRoot, 'projects', P, 'executions', executionId, 'events.jsonl');
  if (!existsSync(file)) return null;
  let calls = 0;
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line).event;
    if (event.type !== 'TOOL_INVOCATION_STARTED') continue;
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.toolName)) return calls;
    calls += 1;
  }
  return calls;
}

/** Whether the final code builds on what existed (scenario "reuse" checks), per task. */
function reuse(repo, task) {
  const check = task.reuse;
  if (!check) return null;
  const read = path => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), 'utf8') : '');
  const file = read(check.file);
  const sources = git(repo, 'ls-files', 'src').split('\n').filter(Boolean);
  const defines = sources.filter(path =>
    new RegExp(`(function\\s+${check.single}\\b|const\\s+${check.single}\\s*=)`).test(read(path)),
  );
  const problems = [];
  if (check.mustNotContain && file.includes(check.mustNotContain)) problems.push('dejó la versión a medias');
  if (defines.length !== 1)
    problems.push(
      defines.length
        ? `${check.single} definido ${defines.length} veces (${defines.join(', ')})`
        : `${check.single} no existe`,
    );
  else if (defines[0] !== check.file) problems.push(`${check.single} en ${defines[0]} en vez de ${check.file}`);
  if (check.uses && !new RegExp(check.uses).test(read(defines[0] ?? check.file)))
    problems.push(`no reutiliza ${check.uses.replace('|', ' ni ')}`);
  return { ok: problems.length === 0, problems };
}

/** The hidden tests on the arm's main, per task. */
function judge(repo) {
  const dir = mkdtempSync(join(out, 'judge-'));
  git(repo, 'worktree', 'add', '--quiet', '--detach', dir, 'main');
  cpSync(join(SCENARIO, 'hidden'), join(dir, '.bench-hidden'), { recursive: true });
  const results = {};
  for (const file of readdirSync(join(SCENARIO, 'hidden')).filter(item => item.endsWith('.test.mjs'))) {
    writeFileSync(
      join(dir, 'tests', `zz-${file}`),
      readFileSync(join(SCENARIO, 'hidden', file), 'utf8').replaceAll("'../src/", "'../src/"),
    );
    const run = spawnSync('node', ['--test', join('tests', `zz-${file}`)], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const count = key => Number(new RegExp(`ℹ ${key} (\\d+)`).exec(run.stdout)?.[1] ?? 0);
    results[file.split('-')[0].toUpperCase()] = { pass: count('pass'), fail: count('fail') || (count('pass') ? 0 : 1) };
  }
  return results;
}

async function arm(armName, base, map) {
  const { createWorkspaceCore } = await dist('bootstrap/workspace-core.js');
  const { openDatabase, closeDatabase } = await dist('platform/sqlite/database.js');
  const repo = join(out, `${armName}-repo`);
  execFileSync('git', ['clone', '--quiet', base, repo]);
  git(repo, 'config', 'user.name', 'Graph Bench');
  git(repo, 'config', 'user.email', 'bench@graphdev.local');
  const workspaceRoot = join(out, armName);
  const core = createWorkspaceCore(workspaceRoot, () => undefined);
  const h = (channel, ...rest) => core.handle({ channel, args: rest });
  const P = (await h('project:create', { name: `R3 ${armName}`, slug: `r3-${armName}` })).id;
  const opened = await h('project:open', P);
  await h('repository:configure', P, repo);
  await h('policy:update', P, { ...spec.policy, maxExecutionMinutes: 15 });
  const rootId = opened.graph.nodes.find(node => node.type === 'PROJECT_ROOT').id;
  const db = openDatabase({ filename: join(workspaceRoot, 'projects', P, 'workspace.sqlite'), initialize: false });
  let ids;
  try {
    ids = await seed(db, P, rootId, repo, map);
  } finally {
    closeDatabase(db);
  }
  const rows = [];
  for (const task of spec.tasks) {
    const featureId = ids[task.id].feature;
    await h('pilot:set_autonomy', P, featureId, {
      level: 'PILOT',
      executionModel: model,
      maxAttempts: 2,
      usagePauseThreshold: 0.99,
      groupTasks: false,
    });
    await h('pilot:start', P, featureId, { acknowledgeCost: true });
    let state;
    for (;;) {
      state = await h('pilot:get', P, featureId);
      if (state.run.status !== 'RUNNING' && state.run.status !== 'PAUSED') break;
      await new Promise(done => setTimeout(done, state.run.status === 'PAUSED' ? 30_000 : 2000));
    }
    const { report } = await h('metrics:feature_report', P, featureId);
    const executions = report.tasks.find(item => item.displayKey)?.executions ?? [];
    const branch = (await h('execution:list', P)).find(
      execution => execution.workItemId === ids[task.id].task,
    )?.baseBranch;
    if (branch) spawnSync('git', ['merge', '--quiet', '--no-edit', branch], { cwd: repo, encoding: 'utf8' });
    const row = {
      id: task.id,
      title: task.title,
      pilot: state.run.status,
      done: report.tasks.some(item => item.status === 'DONE'),
      attempts: executions.length,
      firstTry: executions.length === 1 && report.tasks.some(item => item.status === 'DONE'),
      exploration: executions.map(item => exploration(workspaceRoot, P, item.executionId)),
      uncachedInput: executions.reduce((total, item) => total + item.uncachedInputTokens, 0),
      cacheRead: executions.reduce((total, item) => total + item.cacheReadTokens, 0),
      output: executions.reduce((total, item) => total + item.outputTokens, 0),
      durationMs: executions.reduce((total, item) => total + (item.durationMs ?? 0), 0),
    };
    rows.push(row);
    log(armName, JSON.stringify(row));
  }
  core.close();
  for (const row of rows)
    row.reuse = reuse(
      repo,
      spec.tasks.find(task => task.id === row.id),
    );
  return { rows, hidden: judge(repo) };
}

const base = baseRepository();
log('output', out);
const mapped = await survey(base);
const results = { 'sin-mapa': await arm('sin-mapa', base, null), 'con-mapa': await arm('con-mapa', base, mapped.map) };
writeFileSync(join(out, 'results.json'), JSON.stringify({ survey: mapped, results }, null, 2));

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const first = rows => rows.map(row => row.exploration[0]).filter(value => value !== null && value !== undefined);
const lines = [
  `# Benchmark R3: mapa del código (${name})`,
  '',
  `Fecha: ${new Date().toISOString().slice(0, 10)} · Modelo: ${model} · Base: \`${git(base, 'rev-parse', 'HEAD')}\``,
  '',
  spec.description,
  '',
  '| | Sin mapa | Con mapa |',
  '| :--- | ---: | ---: |',
];
const both = fn => `| ${fn[0]} | ${fn[1](results['sin-mapa'])} | ${fn[1](results['con-mapa'])} |`;
for (const row of [
  ['Tareas hechas al primer intento', r => `${r.rows.filter(x => x.firstTry).length} de ${r.rows.length}`],
  [
    'Pruebas ocultas (pasan / fallan)',
    r =>
      `${Object.values(r.hidden).reduce((t, x) => t + x.pass, 0)} / ${Object.values(r.hidden).reduce((t, x) => t + x.fail, 0)}`,
  ],
  ['Reutilizan el código existente', r => `${r.rows.filter(x => x.reuse?.ok).length} de ${r.rows.length}`],
  [
    'Llamadas a herramientas antes del primer cambio (1.er intento)',
    r => first(r.rows).join(' + ') + ` = ${first(r.rows).reduce((t, x) => t + x, 0)}`,
  ],
  ['Tokens de entrada sin caché', r => sum(r.rows, 'uncachedInput').toLocaleString('es')],
  ['Tokens leídos de caché', r => sum(r.rows, 'cacheRead').toLocaleString('es')],
  ['Tokens de salida', r => sum(r.rows, 'output').toLocaleString('es')],
  ['Tiempo del motor', r => `${(sum(r.rows, 'durationMs') / 60000).toFixed(1)} min`],
])
  lines.push(both(row));
lines.push(
  '',
  '| Tarea | Sin mapa: intentos · exploración · reutiliza | Con mapa: intentos · exploración · reutiliza |',
  '| :--- | :--- | :--- |',
);
for (const task of spec.tasks) {
  const cell = r => {
    const row = r.rows.find(item => item.id === task.id);
    const hidden = r.hidden[task.id];
    return `${row.attempts} · ${row.exploration.join('/')} · ${row.reuse?.ok ? 'sí' : `no (${row.reuse?.problems.join('; ')})`} · ocultas ${hidden?.pass ?? 0}/${(hidden?.pass ?? 0) + (hidden?.fail ?? 0)}`;
  };
  lines.push(`| ${task.id} ${task.title} | ${cell(results['sin-mapa'])} | ${cell(results['con-mapa'])} |`);
}
const capabilities = mapped.map.modules.reduce((total, module) => total + module.capabilities.length, 0);
lines.push(
  '',
  `Mapa: ${mapped.map.modules.length} módulos, ${capabilities} capacidades, ${Math.round(mapped.ms / 1000)} s, ${JSON.stringify(mapped.usage)}.`,
);
const report = `${lines.join('\n')}\n`;
if (args.report) writeFileSync(resolve(args.report), report);
console.log(report);
