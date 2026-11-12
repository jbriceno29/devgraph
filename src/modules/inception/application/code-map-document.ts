import type { RepositorySurveyDto, SurveyNoteDto } from '../../../shared/contracts/repository-survey.js';

const files = (paths: readonly string[]) => paths.map(path => `\`${path}\``).join(', ');
const notes = (items: readonly SurveyNoteDto[]) => items.map(item => `- ${item.description} (${files(item.evidence)})`);

/**
 * docs/MAPA_DEL_CODIGO.md (plan REP, R3): what the repository already has, written by the app from the checked map, so
 * it reaches every task's context as a project document and the user can read and correct it in Git.
 */
export function codeMapMarkdown(survey: RepositorySurveyDto): string {
  const lines = [
    '# Mapa del código',
    '',
    `Lo que ya existe en el repositorio, leído en \`${survey.ref}\` (commit \`${survey.commit.slice(0, 12)}\`). Cada capacidad cita los archivos que la respaldan. Antes de crear algo, comprueba aquí si ya existe.`,
  ];
  for (const module of survey.modules) {
    lines.push('', `## ${module.name}`, '');
    if (module.summary) lines.push(module.summary, '');
    if (module.paths.length) lines.push(`Dónde vive: ${files(module.paths)}.`, '');
    for (const capability of module.capabilities) {
      const state = capability.status === 'PARTIAL' ? 'parcial' : 'completa';
      lines.push(
        `- **${capability.title}** (${state}): ${capability.summary} Archivos: ${files(capability.evidence)}.`,
      );
      if (capability.missing) lines.push(`  - Falta: ${capability.missing}`);
    }
  }
  if (survey.entryPoints.length) lines.push('', '## Puntos de entrada', '', ...notes(survey.entryPoints));
  if (survey.tests.description)
    lines.push(
      '',
      '## Pruebas',
      '',
      `${survey.tests.description}${survey.tests.evidence.length ? ` (${files(survey.tests.evidence)})` : ''}`,
    );
  if (survey.pending.length) lines.push('', '## Pendientes visibles', '', ...notes(survey.pending));
  return `${lines.join('\n')}\n`;
}
