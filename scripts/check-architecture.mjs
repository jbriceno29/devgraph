#!/usr/bin/env node
/**
 * Architecture rules of docs/PROPUESTA_ARQUITECTURA.md §5, checked on src/.
 *
 *   node scripts/check-architecture.mjs            report; exit 1 on a new or grown violation
 *   node scripts/check-architecture.mjs --update   lower the baseline to what is left (never raises a number)
 *
 * The baseline (scripts/architecture-baseline.json) lists what broke a rule when the rules arrived. A file in it may
 * not get worse; anything else must comply. Each refactor lowers it, and it is deleted once it is empty.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'architecture-baseline.json');
export const LIMITS = { tsLines: 300, tsxLines: 250, functionLines: 60, stringChars: 400 };
export const RULES = {
  'file-size': `Archivo .ts ≤ ${LIMITS.tsLines} líneas y .tsx ≤ ${LIMITS.tsxLines} (valor: líneas)`,
  'function-size': `Función ≤ ${LIMITS.functionLines} líneas (valor: líneas de más, sumadas)`,
  'long-string': `Textos de más de ${LIMITS.stringChars} caracteres van en prompts/*.md (valor: cuántos)`,
  layers: 'Dependencias entre capas y módulos (valor: imports prohibidos)',
  sql: 'SQL solo en la persistencia (valor: consultas fuera de sitio)',
  'ipc-access': 'window.workspaceIpc solo en desktop/core/ipc, desktop/platform y *.api.ts (valor: usos)',
};

const posix = path => path.split(sep).join('/');
function listSources(directory) {
  const out = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...listSources(path));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Which layer a src-relative path belongs to (null: no layer rule). */
export function layerOf(file) {
  const module = file.match(/^src\/modules\/([^/]+)\/(domain|application|infrastructure)\//);
  if (module) return { layer: module[2], module: module[1] };
  if (file.startsWith('src/domain/')) return { layer: 'domain' };
  if (file.startsWith('src/application/')) return { layer: 'application' };
  if (file.startsWith('src/shared/contracts/')) return { layer: 'contracts' };
  if (file.startsWith('src/shared/kernel/')) return { layer: 'kernel' };
  if (file.startsWith('src/desktop/')) return { layer: 'desktop' };
  return null;
}
const RUNTIME = /^(node:|better-sqlite3$|child_process$|fs$|path$|os$|crypto$)/;
/** Why an import from `file` to `target` (src-relative path, or a package name) breaks a rule; null if it is allowed. */
export function importViolation(file, target) {
  const from = layerOf(file);
  if (!target.startsWith('src/')) {
    if (!RUNTIME.test(target)) return null;
    return from && ['domain', 'application', 'contracts', 'kernel', 'desktop'].includes(from.layer)
      ? `${from.layer} no usa ${target}: recibe un puerto (Clock, IdGenerator…)`
      : null;
  }
  const own = file.match(/^src\/modules\/([^/]+)\//)?.[1],
    other = target.match(/^src\/modules\/([^/]+)\//)?.[1];
  if (own && other && own !== other && target !== `src/modules/${other}/index.ts`)
    return `el módulo ${own} solo usa ${other} por su index.ts`;
  if (!from) return null;
  const to = layerOf(target);
  const shared = target.startsWith('src/shared/');
  switch (from.layer) {
    case 'kernel':
      return target.startsWith('src/shared/kernel/') ? null : 'shared/kernel no importa nada fuera de sí';
    case 'contracts':
      return shared ? null : 'shared/contracts solo importa shared/*';
    case 'desktop':
      return shared || target.startsWith('src/desktop/') ? null : 'desktop solo importa desktop y shared/*';
    case 'domain':
      return to?.layer === 'domain' || target.startsWith('src/shared/kernel/') || target.startsWith('src/shared/types/')
        ? null
        : 'domain solo importa domain, shared/kernel y shared/types';
    case 'application':
      return to?.layer === 'domain' ||
        to?.layer === 'application' ||
        shared ||
        /^src\/modules\/[^/]+\/index\.ts$/.test(target)
        ? null
        : 'application no importa infraestructura, plataforma ni interfaz';
    default:
      return null;
  }
}

const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|PRAGMA)\b/i;
export const sqlAllowed = file =>
  file.startsWith('src/infrastructure/persistence/') ||
  file.startsWith('src/platform/sqlite/') ||
  /^src\/modules\/[^/]+\/infrastructure\/sqlite-[^/]+\.ts$/.test(file);
export const ipcAllowed = file =>
  !file.startsWith('src/desktop/') ||
  file.startsWith('src/desktop/core/ipc/') ||
  file.startsWith('src/desktop/platform/') ||
  file.endsWith('.api.ts');
const stringAllowed = file => /\/prompts\//.test(file);

function resolveImport(file, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const base = posix(relative(ROOT, resolve(ROOT, dirname(file), specifier)));
  for (const candidate of [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}/index.ts`,
  ])
    if (existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile()) return candidate;
  return base.replace(/\.js$/, '.ts');
}

/** Measures one file: { rule: value } plus details for the report. */
export function measure(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = position => source.getLineAndCharacterOfPosition(position).line + 1;
  const values = {},
    details = {};
  const add = (rule, amount, note) => {
    values[rule] = (values[rule] ?? 0) + amount;
    (details[rule] ??= []).push(note);
  };
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const limit = file.endsWith('.tsx') ? LIMITS.tsxLines : LIMITS.tsLines;
  if (lines > limit) add('file-size', lines, `${lines} líneas (máximo ${limit})`);
  const visit = node => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const start = lineOf(node.getStart(source)),
        length = lineOf(node.getEnd()) - start + 1;
      if (length > LIMITS.functionLines) {
        const name =
          node.name?.getText(source) ??
          (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : 'anónima');
        add('function-size', length - LIMITS.functionLines, `${name} (línea ${start}): ${length} líneas`);
      }
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      !stringAllowed(file) &&
      node.getText(source).length > LIMITS.stringChars &&
      !SQL.test(node.getText(source).slice(1))
    )
      add('long-string', 1, `línea ${lineOf(node.getStart(source))}: ${node.getText(source).length} caracteres`);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'prepare' &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isTemplateLiteral(node.arguments[0])) &&
      SQL.test(node.arguments[0].getText(source).slice(1)) &&
      !sqlAllowed(file)
    )
      add('sql', 1, `línea ${lineOf(node.getStart(source))}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'workspaceIpc' &&
      node.expression.getText(source) === 'window' &&
      !ipcAllowed(file)
    )
      add('ipc-access', 1, `línea ${lineOf(node.getStart(source))}`);
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
          ? node.argument.literal.text
          : ts.isCallExpression(node) &&
              node.expression.kind === ts.SyntaxKind.ImportKeyword &&
              ts.isStringLiteral(node.arguments[0] ?? node)
            ? node.arguments[0].text
            : null;
    if (specifier) {
      const why = importViolation(file, resolveImport(file, specifier));
      if (why) add('layers', 1, `línea ${lineOf(node.getStart(source))}: ${specifier} — ${why}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { values, details };
}

export function checkArchitecture({ root = ROOT, baseline = readBaseline() } = {}) {
  const measured = {};
  for (const path of listSources(join(root, 'src'))) {
    const file = posix(relative(root, path));
    measured[file] = measure(file, readFileSync(path, 'utf8'));
  }
  const violations = [],
    improvements = [];
  for (const [file, { values, details }] of Object.entries(measured))
    for (const [rule, value] of Object.entries(values)) {
      const allowed = baseline[rule]?.[file] ?? 0;
      if (value > allowed)
        violations.push({
          rule,
          file,
          value,
          allowed,
          details: details[rule],
        });
    }
  for (const [rule, files] of Object.entries(baseline))
    for (const [file, allowed] of Object.entries(files)) {
      const value = measured[file]?.values[rule] ?? 0;
      if (value < allowed) improvements.push({ rule, file, value, allowed });
    }
  return { violations, improvements, measured };
}

function readBaseline() {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
}

function lowerBaseline(baseline, measured) {
  const next = {};
  for (const [rule, files] of Object.entries(baseline))
    for (const [file, allowed] of Object.entries(files)) {
      const value = Math.min(allowed, measured[file]?.values[rule] ?? 0);
      if (value > 0) (next[rule] ??= {})[file] = value;
    }
  return next;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const init = process.argv.includes('--init'),
    update = process.argv.includes('--update');
  const baseline = init ? {} : readBaseline();
  const { violations, improvements, measured } = checkArchitecture({ baseline });
  if (init) {
    const all = {};
    for (const [file, { values }] of Object.entries(measured))
      for (const [rule, value] of Object.entries(values)) (all[rule] ??= {})[file] = value;
    writeFileSync(BASELINE, `${JSON.stringify(all, null, 2)}\n`);
    console.log(
      `Línea base creada con ${Object.values(all).reduce((n, files) => n + Object.keys(files).length, 0)} entradas.`,
    );
    process.exit(0);
  }
  for (const v of violations) {
    console.error(
      `✗ [${v.rule}] ${v.file}: ${v.value}${v.allowed ? ` (línea base ${v.allowed})` : ''} — ${RULES[v.rule]}`,
    );
    for (const detail of v.details ?? []) console.error(`    ${detail}`);
  }
  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(lowerBaseline(baseline, measured), null, 2)}\n`);
    console.log(`Línea base actualizada (${improvements.length} entradas bajaron).`);
  } else if (improvements.length)
    console.log(`${improvements.length} entradas de la línea base mejoraron: ejecuta con --update para fijarlas.`);
  if (violations.length) {
    console.error(`\n${violations.length} incumplimientos. Ver CLAUDE.md y docs/PROPUESTA_ARQUITECTURA.md §5.`);
    process.exit(1);
  }
  console.log('Arquitectura: sin incumplimientos nuevos.');
}
