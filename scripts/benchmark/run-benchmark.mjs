#!/usr/bin/env node
/**
 * Stage 5 benchmark for multi-feature scenarios (scripts/benchmark/<scenario>/scenario.json + hidden/).
 *
 * Arms, all from the same commit, same model and permissions:
 *   chat-long   one Claude Code conversation for every task (`--resume`), as one long chat.
 *   chat-days   a new conversation per feature, as a person picking the work up another day.
 *   workspace   Graph Workspace on a copy of the project: one autopilot per feature, in order. Between features the
 *               feature branch is merged into main, as the user would before starting the next feature.
 *   workspace-grouped  The same, with the autopilot's task grouping on (Etapa 0): the scenario is NOT pre-grouped; the
 *               pilot decides on its own which small tasks run together (2–3 per execution, convention-fixing tasks alone).
 *
 * The judge is the scenario's hidden tests; tests whose name mentions RangeError check the project convention set in the
 * first task and never repeated afterwards.
 *
 * A scenario may reuse another scenario's judge ("hidden": "<scenario>") and group several original tasks into one
 * ("covers": ["A1", "A2"]): the report then grades every original task covered, so a grouped variant is scored on the
 * same hidden tests as the original.
 *
 * Usage (npm run build:core first):
 *   node scripts/benchmark/run-benchmark.mjs --scenario todo-v2 --base <repo> --ref <commit> [--workspace <app data dir>
 *     --project <id>] [--model haiku] [--max-turns <n>] [--arms chat-long,chat-days,workspace,workspace-grouped] [--out <dir>]
 *     [--report <file.md>] [--group-size 3] [--skills on]   (--skills on: interface tasks get the bundled skills; default off, as in the app)
 *   Without --workspace/--project the workspace arms create a fresh project (default profiles and policy) in --out.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs),
      [],
    ),
);
for (const required of ['scenario', 'base', 'ref'])
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(2);
  }
if (Boolean(args.workspace) !== Boolean(args.project)) {
  console.error('--workspace and --project go together');
  process.exit(2);
}
const SCENARIO = join(ROOT, 'scripts', 'benchmark', args.scenario);
const spec = JSON.parse(readFileSync(join(SCENARIO, 'scenario.json'), 'utf8'));
const HIDDEN = join(ROOT, 'scripts', 'benchmark', spec.hidden ?? args.scenario, 'hidden');
/** Original tasks graded by the judge, with their titles when the scenario groups them. */
const judged = spec.hidden
  ? JSON.parse(readFileSync(join(ROOT, 'scripts', 'benchmark', spec.hidden, 'scenario.json'), 'utf8')).tasks
  : spec.tasks;
const model = args.model ?? 'haiku';
const arms = (args.arms ?? 'chat-long,chat-days,workspace').split(',');
const out = resolve(args.out ?? mkdtempSync(join(tmpdir(), `graphdev2-${spec.name}-`)));
mkdirSync(out, { recursive: true });
const policy = spec.policy ?? {
  writablePaths: ['src/**', 'tests/**'],
  readonlyPaths: [],
  deniedPaths: ['.env*'],
  allowedCommands: ['node --test'],
};
/** Scenario options for projects with dependencies (plan S3): commands that prepare a clone, the checks each chat task runs, the judge, and the tag that marks convention tests. */
const setupCommands = spec.setup ?? [];
const verifyCommands = (spec.verify ?? ['node --test']).map(command => command.split(' '));
const conventionTag = spec.conventionTag ?? 'RangeError';
const setup = cwd => {
  for (const [command, ...rest] of setupCommands) {
    const run = spawnSync(command, rest, { cwd, encoding: 'utf8', timeout: 600_000 });
    if (run.status !== 0) throw new Error(`setup failed in ${cwd}: ${command} ${rest.join(' ')}\n${run.stderr}`);
  }
};
const { buildClaudePermissionArgs } = await import(join(ROOT, 'dist/main/infrastructure/ai/claude-code-adapter.js'));
const { buildChildEnvironment } = await import(join(ROOT, 'dist/main/infrastructure/ai/child-environment.js'));
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, encoding: 'utf8' }).trim();

function cloneBase(target) {
  execFileSync('git', ['clone', '--quiet', args.base, target]);
  git(target, 'checkout', '--quiet', '-B', 'main', args.ref);
  git(target, 'config', 'user.name', 'Graph Bench');
  git(target, 'config', 'user.email', 'bench@graphdev.local');
}

const taskPrompt = task =>
  `Tarea ${task.key}: ${task.title}\n\n${task.summary}\n\nCriterios de aceptación:\n${task.criteria.map(item => `- ${item}`).join('\n')}\n\n${spec.promptNote ?? 'Trabaja en este repositorio (ESM, sin dependencias). Añade o ajusta pruebas en tests/ y ejecuta node --test antes de terminar.'}`;

/** Hidden tests per task: { [taskId]: { pass, fail, convention: { pass, fail } } }. */
function judge(repo, ref) {
  const dir = mkdtempSync(join(out, 'judge-'));
  git(repo, 'worktree', 'add', '--quiet', '--detach', dir, ref);
  cpSync(HIDDEN, join(dir, '.bench-hidden'), { recursive: true });
  const results = {};
  if (spec.judge === 'vitest') {
    // The judge installs from the lockfile and runs the hidden tests with its own config, whatever the agent did to vite.config.ts.
    setup(dir);
    writeFileSync(
      join(dir, '.bench-hidden', 'vitest.judge.config.mjs'),
      "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['.bench-hidden/**/*.test.ts'], environment: 'jsdom' } });\n",
    );
    spawnSync(
      join(dir, 'node_modules', '.bin', 'vitest'),
      [
        'run',
        '--config',
        '.bench-hidden/vitest.judge.config.mjs',
        '--reporter=json',
        '--outputFile=.bench-hidden/out.json',
      ],
      { cwd: dir, encoding: 'utf8', timeout: 300_000 },
    );
    let report = { testResults: [] };
    try {
      report = JSON.parse(readFileSync(join(dir, '.bench-hidden', 'out.json'), 'utf8'));
    } catch {
      /* every task fails below */
    }
    for (const file of readdirSync(HIDDEN)
      .filter(name => /\.test\./.test(name))
      .sort()) {
      const id = file.split('.')[0].toUpperCase();
      const suite = report.testResults.find(item => item.name.endsWith(`/.bench-hidden/${file}`));
      const subtests = (suite?.assertionResults ?? []).map(item => ({
        ok: item.status === 'passed',
        name: item.title,
      }));
      const pass = subtests.filter(item => item.ok).length,
        fail = subtests.length - pass || (pass === 0 ? 1 : 0);
      const convention = subtests.filter(item => item.name.includes(conventionTag));
      results[id] = {
        pass,
        fail,
        convention: {
          pass: convention.filter(item => item.ok).length,
          fail: convention.filter(item => !item.ok).length,
        },
      };
    }
    git(repo, 'worktree', 'remove', '--force', dir);
    return results;
  }
  for (const file of readdirSync(join(dir, '.bench-hidden')).sort()) {
    const run = spawnSync('node', ['--test', '--test-reporter=tap', join('.bench-hidden', file)], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const subtests = [...run.stdout.matchAll(/^\s*(not ok|ok) \d+ - (.+)$/gm)]
      .map(match => ({ ok: match[1] === 'ok', name: match[2] }))
      .filter(item => !item.name.endsWith('.mjs'));
    const pass = subtests.filter(item => item.ok).length,
      fail = subtests.length - pass || (run.status !== 0 && pass === 0 ? 1 : 0);
    const convention = subtests.filter(item => item.name.includes(conventionTag));
    results[file.split('.')[0].toUpperCase()] = {
      pass,
      fail,
      convention: { pass: convention.filter(item => item.ok).length, fail: convention.filter(item => !item.ok).length },
    };
  }
  git(repo, 'worktree', 'remove', '--force', dir);
  return results;
}

async function chatArm(name, newSessionPerFeature) {
  const repo = join(out, `${name}-repo`);
  cloneBase(repo);
  setup(repo);
  const env = buildChildEnvironment(process.env, { authMode: 'subscription' });
  const rows = [];
  let session = null,
    feature = null;
  for (const task of spec.tasks) {
    if (newSessionPerFeature && task.feature !== feature) session = null;
    feature = task.feature;
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
      result = { is_error: true, result: (run.stderr || run.stdout || '').slice(-500) };
    }
    session = result.session_id ?? session;
    const usage = result.usage ?? {};
    const own = verifyCommands
      .map(([command, ...rest]) => spawnSync(command, rest, { cwd: repo, encoding: 'utf8', timeout: 120_000 }))
      .find(run => run.status !== 0) ?? { status: 0 };
    git(repo, 'add', '-A');
    spawnSync('git', ['commit', '--quiet', '--allow-empty', '-m', `${task.key}: ${task.title}`], { cwd: repo });
    const row = {
      id: task.id,
      key: task.key,
      ok: result.is_error !== true,
      error: result.is_error ? String(result.result ?? '').slice(0, 300) : null,
      uncachedInput: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      durationMs: Date.now() - started,
      denied: result.permission_denials?.length ?? 0,
      ownTestsPass: own.status === 0,
      executions: 1,
    };
    rows.push(row);
    log(name, task.key, JSON.stringify(row));
  }
  return { rows, hidden: judge(repo, 'HEAD'), humanMessages: spec.tasks.length };
}

async function workspaceArm(name = 'workspace', grouped = false) {
  const { createWorkspaceCore } = await import(join(ROOT, 'dist/main/infrastructure/ipc/sidecar/workspace-core.js'));
  const { openDatabase, closeDatabase } = await import(
    join(ROOT, 'dist/main/infrastructure/persistence/sqlite/database.js')
  );
  const repo = join(out, `${name}-repo`);
  cloneBase(repo);
  const workspaceRoot = join(out, name);
  let P = args.project;
  if (P) {
    mkdirSync(join(workspaceRoot, 'projects', P), { recursive: true });
    const source = openDatabase({ filename: join(args.workspace, 'projects', P, 'workspace.sqlite'), readonly: true });
    await source.backup(join(workspaceRoot, 'projects', P, 'workspace.sqlite'));
    closeDatabase(source);
  }
  const core = createWorkspaceCore(workspaceRoot, () => undefined);
  const h = (channel, ...rest) => core.handle({ channel, args: rest });
  if (!P) P = (await h('project:create', { name: `Benchmark ${spec.name}`, slug: `bench-${spec.name}` })).id;
  const opened = await h('project:open', P);
  if (spec.stackProfile) {
    const db = openDatabase({ filename: join(workspaceRoot, 'projects', P, 'workspace.sqlite'), initialize: false });
    try {
      db.prepare('UPDATE projects SET stack_profile_id=?,skills_enabled=? WHERE id=?').run(
        spec.stackProfile,
        args.skills === 'on' ? 1 : 0,
        P,
      );
    } finally {
      closeDatabase(db);
    }
  }
  await h('repository:configure', P, repo);
  await h('policy:update', P, {
    ...policy,
    maxExecutionMinutes: 15,
    ...(args['max-turns'] ? { maxTurns: Number(args['max-turns']) } : {}),
  });
  const moduleId = opened.graph.nodes.find(node => node.type === 'MODULE')?.id;
  const featureIds = Object.fromEntries(
    spec.features.map(feature => [feature.key, `bench-${feature.key.toLowerCase()}`]),
  );
  const taskIds = Object.fromEntries(spec.tasks.map(task => [task.id, `bench-${task.id.toLowerCase()}`]));
  const db = openDatabase({ filename: join(workspaceRoot, 'projects', P, 'workspace.sqlite'), initialize: false });
  try {
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    for (const feature of spec.features) {
      insert.run(featureIds[feature.key], P, 'FEATURE', feature.key, feature.title, feature.summary, 'DRAFT', moduleId);
      db.prepare(`INSERT INTO features(entity_id,scope,priority) VALUES(?,?,'HIGH')`).run(
        featureIds[feature.key],
        feature.summary,
      );
    }
    for (const task of spec.tasks) {
      insert.run(
        taskIds[task.id],
        P,
        'WORK_ITEM',
        task.key,
        task.title,
        task.summary,
        task.dependsOn.length ? 'BLOCKED' : 'READY',
        featureIds[task.feature],
      );
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH',?,'DEVELOPER')`,
      ).run(taskIds[task.id], JSON.stringify(task.criteria));
      for (const dependency of task.dependsOn)
        db.prepare(
          `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
        ).run(`bench-${task.id}-${dependency}`, P, taskIds[task.id], taskIds[dependency]);
    }
  } finally {
    closeDatabase(db);
  }
  const pilots = [];
  let rows = [];
  for (const feature of spec.features) {
    const featureId = featureIds[feature.key];
    await h('pilot:set_autonomy', P, featureId, {
      level: 'PILOT',
      executionModel: model,
      maxAttempts: 2,
      usagePauseThreshold: 0.99,
      groupTasks: grouped,
      maxGroupSize: Number(args['group-size'] ?? 3),
    });
    await h('pilot:start', P, featureId, { acknowledgeCost: true });
    let state,
      seen = 0;
    for (;;) {
      state = await h('pilot:get', P, featureId);
      for (const event of state.events.slice(seen)) log(name, event.kind, event.message);
      seen = state.events.length;
      // PAUSED (usage window): the pilot resumes on its own when the window renews; keep waiting.
      if (state.run.status !== 'RUNNING' && state.run.status !== 'PAUSED') break;
      await new Promise(done => setTimeout(done, state.run.status === 'PAUSED' ? 30_000 : 2000));
    }
    pilots.push({
      feature: feature.key,
      status: state.run.status,
      reason: state.run.reason,
      waits: state.events.filter(event => event.kind === 'WAITING_USER').length,
    });
    const finished = state.run.status === 'COMPLETED';
    if (!finished)
      log(
        name,
        `pilot of ${feature.key} ended ${state.run.status}${state.run.reason ? ` (${state.run.reason})` : ''}: the arm stops here; the report covers the features closed so far.`,
      );
    const { report } = await h('metrics:feature_report', P, featureId);
    // A grouped execution shows under every task it covers: its tokens and time count once, on the first task listed.
    const counted = new Set();
    rows = rows.concat(
      spec.tasks
        .filter(task => task.feature === feature.key)
        .map(task => {
          const all = report.tasks.find(item => item.displayKey === task.key)?.executions ?? [];
          const executions = all.filter(item => !counted.has(item.executionId));
          for (const item of executions) counted.add(item.executionId);
          return {
            id: task.id,
            key: task.key,
            ok: report.tasks.find(item => item.displayKey === task.key)?.status === 'DONE',
            executions: executions.length,
            sharedWith: all.length - executions.length,
            uncachedInput: executions.reduce((total, item) => total + item.uncachedInputTokens, 0),
            cacheRead: executions.reduce((total, item) => total + item.cacheReadTokens, 0),
            output: executions.reduce((total, item) => total + item.outputTokens, 0),
            durationMs: executions.reduce((total, item) => total + (item.durationMs ?? 0), 0),
            denied: executions.reduce((total, item) => total + item.deniedActions, 0),
            ownTestsPass: all.at(-1)?.checksPassed ?? false,
          };
        }),
    );
    // As the user would before the next feature: integrate this feature into main.
    const branch = (await h('execution:list', P)).find(
      execution =>
        execution.workItemId &&
        Object.values(taskIds).includes(execution.workItemId) &&
        execution.baseBranch?.startsWith('feature/') &&
        spec.tasks.find(task => taskIds[task.id] === execution.workItemId)?.feature === feature.key,
    )?.baseBranch;
    if (branch) {
      const merged = spawnSync('git', ['merge', '--quiet', '--no-edit', branch], { cwd: repo, encoding: 'utf8' });
      log(name, `merge ${branch} into main:`, merged.status === 0 ? 'ok' : merged.stderr.slice(0, 200));
    }
    if (!finished) break;
  }
  core.close();
  return {
    rows,
    hidden: judge(repo, 'main'),
    humanMessages: pilots.reduce((total, pilot) => total + pilot.waits, 0),
    pilots,
  };
}

log('output', out);
const results = {};
for (const arm of arms)
  results[arm] =
    arm === 'workspace'
      ? await workspaceArm()
      : arm === 'workspace-grouped'
        ? await workspaceArm(arm, true)
        : await chatArm(arm, arm === 'chat-days');
writeFileSync(join(out, 'raw.json'), JSON.stringify(results, null, 2));

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const hiddenSum = (hidden, pick) =>
  Object.values(hidden).reduce(
    (total, item) => ({ pass: total.pass + pick(item).pass, fail: total.fail + pick(item).fail }),
    { pass: 0, fail: 0 },
  );
const full = hidden => Object.values(hidden).filter(item => item.fail === 0 && item.pass > 0).length;
const k = value => value.toLocaleString('es'),
  min = ms => `${(ms / 60_000).toFixed(1)} min`;
const label = {
  'chat-long': 'Chat: una conversación',
  'chat-days': 'Chat: una por feature',
  workspace: 'Graph Workspace (piloto)',
  'workspace-grouped': 'Graph Workspace (piloto, agrupando)',
};
const row = (title, cell) => `| ${title} | ${arms.map(arm => cell(results[arm])).join(' | ')} |`;
const lines = [
  `# Benchmark Etapa 5: ${spec.name}`,
  '',
  `Fecha: ${new Date().toISOString().slice(0, 10)} · Modelo: ${model} · Base: \`${args.ref}\``,
  '',
  spec.description,
  '',
  `| | ${arms.map(arm => label[arm]).join(' | ')} |`,
  `| :--- | ${arms.map(() => '---:').join(' | ')} |`,
  row('Tareas que pasan todas sus pruebas ocultas', r => `${full(r.hidden)} de ${judged.length}`),
  row('Pruebas ocultas (pasan / total)', r => {
    const s = hiddenSum(r.hidden, item => item);
    return `${s.pass} / ${s.pass + s.fail}`;
  }),
  row(`Pruebas de la convención (${conventionTag})`, r => {
    const s = hiddenSum(r.hidden, item => item.convention);
    return `${s.pass} / ${s.pass + s.fail}`;
  }),
  row('Tokens de entrada sin caché', r => k(sum(r.rows, 'uncachedInput'))),
  row('Tokens leídos de caché', r => k(sum(r.rows, 'cacheRead'))),
  row('Tokens de salida', r => k(sum(r.rows, 'output'))),
  row('Costo ponderado (sin caché + 0,1 × leídos)', r =>
    k(Math.round(sum(r.rows, 'uncachedInput') + 0.1 * sum(r.rows, 'cacheRead'))),
  ),
  row('Tiempo del motor', r => min(sum(r.rows, 'durationMs'))),
  row('Ejecuciones', r => String(sum(r.rows, 'executions'))),
  ...(judged !== spec.tasks ? [row('Tareas del escenario (agrupadas)', () => String(spec.tasks.length))] : []),
  row('Acciones denegadas', r => String(sum(r.rows, 'denied'))),
  row('Intervenciones humanas', r =>
    r.pilots ? `${r.humanMessages} (esperas del piloto)` : `${r.humanMessages} mensajes`,
  ),
  '',
  `| Tarea | ${arms.map(arm => `${label[arm]}: ocultas`).join(' | ')} |`,
  `| :--- | ${arms.map(() => '---:').join(' | ')} |`,
  ...judged.map(
    task =>
      `| ${task.key} ${task.title} | ${arms
        .map(arm => {
          const item = results[arm].hidden[task.id];
          return item ? `${item.pass}/${item.pass + item.fail}` : '—';
        })
        .join(' | ')} |`,
  ),
  ...arms
    .filter(arm => results[arm].pilots)
    .map(
      arm =>
        `\nPiloto (${label[arm]}): ${results[arm].pilots.map(pilot => `${pilot.feature} ${pilot.status}${pilot.reason ? ` (${pilot.reason})` : ''}`).join(' · ')}`,
    ),
  '',
  `Notas: "sin caché" incluye la creación de caché; la lectura de caché es mucho más barata. Los brazos chat no tienen reintentos; el piloto tiene hasta 2 intentos por tarea y solo acepta con ${(spec.verify ?? ['node --test']).map(command => `\`${command}\``).join(' y ')} en verde.`,
];
const markdown = `${lines.join('\n')}\n`;
writeFileSync(join(out, 'report.md'), markdown);
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(resolve(args.report), markdown);
}
console.log(`\n${markdown}`);
