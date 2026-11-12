import type { ProjectProfile } from '../../knowledge/index.js';
import { writablePathIssue } from './agent-access.js';

/** Installs or runs package scripts: never a verification command (inception decision 5, the user installs). */
const INSTALL =
  /^(?:npm|pnpm|yarn|bun)\s+(?:i|install|ci|add|exec|dlx|create|init)\b|^(?:npx|pnpx|bunx)\b|^(?:pip3?|pipx|uv|poetry|cargo|go|gem|composer|brew|apt(?:-get)?)\s+(?:install|add|get)\b|^curl\b|^wget\b/i;
const SHELL = /[;&|`$<>\n\r]/;
const LIMITS = { items: 20, paths: 40, text: 400, stackKeys: 12 };

/** Errors of a proposed project profile (empty when valid). Messages are user-facing (Spanish). */
export function profileIssues(profile: Partial<ProjectProfile>): string[] {
  const issues: string[] = [];
  const list = (value: unknown, label: string, required = false, max: number = LIMITS.items) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      issues.push(`${label} debe ser una lista de textos.`);
      return;
    }
    if (required && !value.some(item => item.trim())) issues.push(`${label} no puede estar vacío.`);
    if (value.length > max) issues.push(`${label} admite como mucho ${max} elementos.`);
    if (value.some(item => item.length > LIMITS.text))
      issues.push(`Cada elemento de ${label} admite como mucho ${LIMITS.text} caracteres.`);
  };
  list(profile.objectives, 'El objetivo', true);
  list(profile.outOfScope, 'Lo que queda fuera del alcance');
  list(profile.rules, 'Las reglas');
  list(profile.verificationCommands, 'Los comandos de verificación');
  const stack = profile.techStack;
  if (
    !stack ||
    typeof stack !== 'object' ||
    Array.isArray(stack) ||
    Object.values(stack).some(value => typeof value !== 'string')
  )
    issues.push('El stack debe ser un objeto de textos (por ejemplo {"lenguaje":"TypeScript"}).');
  else if (!Object.keys(stack).length) issues.push('El stack no puede estar vacío.');
  else if (Object.keys(stack).length > LIMITS.stackKeys)
    issues.push(`El stack admite como mucho ${LIMITS.stackKeys} entradas.`);
  for (const command of Array.isArray(profile.verificationCommands) ? profile.verificationCommands : []) {
    if (typeof command !== 'string') continue;
    if (SHELL.test(command))
      issues.push(
        `Comando de verificación no permitido: ${command}. No se admiten tuberías, redirecciones ni operadores de shell.`,
      );
    else if (INSTALL.test(command.trim()))
      issues.push(
        `Comando de verificación no permitido: ${command}. Los comandos no pueden instalar dependencias ni descargar nada.`,
      );
  }
  if (profile.writablePaths !== undefined) {
    list(profile.writablePaths, 'Las rutas que puede escribir el agente', true, LIMITS.paths);
    for (const pattern of Array.isArray(profile.writablePaths) ? profile.writablePaths : []) {
      const issue = typeof pattern === 'string' ? writablePathIssue(pattern) : null;
      if (issue) issues.push(issue);
    }
  }
  if (
    profile.description !== undefined &&
    (typeof profile.description !== 'string' || profile.description.length > 2000)
  )
    issues.push('La descripción debe ser un texto de como mucho 2000 caracteres.');
  return issues;
}

/** Goal, scope and stack in a few lines for every run's level-1 context (token cost matters). Null when there is nothing. */
export function renderProfileForContext(profile: {
  objectives?: string[];
  outOfScope?: string[];
  techStack?: Record<string, unknown>;
}): string | null {
  const clip = (text: string) => (text.length > 200 ? `${text.slice(0, 197)}…` : text);
  const join = (items: string[] | undefined) =>
    (items ?? [])
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map(clip)
      .join('; ');
  const stack = Object.entries(profile.techStack ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .slice(0, LIMITS.stackKeys)
    .map(([key, value]) => `${key}: ${clip(String(value))}`)
    .join('; ');
  const lines = [
    join(profile.objectives) && `Objetivo: ${join(profile.objectives)}`,
    join(profile.outOfScope) && `Fuera de alcance: ${join(profile.outOfScope)}`,
    stack && `Stack: ${stack}`,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}
