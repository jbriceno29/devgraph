import type { ArtifactDocumentRecord } from './ports/artifact-management-port.js';
import type { Artifact } from '../domain/artifacts.js';

export type SupportedArtifactType = Artifact['artifactType'];
export type DocumentTemplateKind = 'ARTIFACT' | 'DECISION_RECORD';

export function artifactPath(type: SupportedArtifactType, title: string): string {
  if (type === 'PRD') return 'docs/PRD.md';
  if (type === 'ARCHITECTURE') return 'docs/ARCHITECTURE.md';
  if (type === 'IMPLEMENTATION_PLAN') return 'docs/implementation-plan.md';
  if (type === 'DOMAIN_DOC') return 'docs/DOMAIN.md';
  if (type === 'SPEC') return `docs/features/${slugify(title)}/specification.md`;
  return `docs/${slugify(title)}.md`;
}

export function createArtifactTemplate(type: SupportedArtifactType, title: string): string {
  const heading = title.trim();
  const sections: Record<SupportedArtifactType, string[]> = {
    PRD: [
      '## Problema',
      '## Usuarios y necesidades',
      '## Objetivos',
      '## Alcance',
      '## Requisitos',
      '## Criterios de aceptación',
      '## Métricas de éxito',
    ],
    ARCHITECTURE: [
      '## Contexto',
      '## Objetivos y restricciones',
      '## Diseño',
      '## Componentes',
      '## Decisiones',
      '## Riesgos',
    ],
    SPEC: [
      '## Contexto',
      '## Comportamiento esperado',
      '## Requisitos funcionales',
      '## Requisitos no funcionales',
      '## Criterios de aceptación',
      '## Verificación',
    ],
    IMPLEMENTATION_PLAN: [
      '## Objetivo',
      '## Alcance',
      '## Etapas',
      '## Entregables',
      '## Criterios de cierre',
      '## Riesgos',
    ],
    DOMAIN_DOC: [
      '## Propósito',
      '## Conceptos del dominio',
      '## Entidades e invariantes',
      '## Flujos',
      '## Decisiones abiertas',
    ],
    OTHER: ['## Resumen', '## Detalles', '## Referencias'],
  };
  return `# ${heading}\n\n${sections[type].map(section => `${section}\n\n`).join('')}`;
}

export function decisionRecordPath(adrNumber: number): string {
  return `docs/architecture/ADR/ADR-${String(adrNumber).padStart(3, '0')}.md`;
}
export function createDecisionRecordTemplate(adrNumber: number, title: string): string {
  return `# ADR-${String(adrNumber).padStart(3, '0')}: ${title.trim()}\n\n- Estado: Propuesto\n- Fecha: ${new Date().toISOString().slice(0, 10)}\n\n## Contexto\n\nDescribe el problema y las fuerzas que motivan esta decisión.\n\n## Decisión\n\nDescribe la decisión tomada.\n\n## Alternativas consideradas\n\n- Alternativa: ventajas y desventajas.\n\n## Consecuencias\n\n- Consecuencias positivas y negativas.\n`;
}

export function parseDecisionRecord(markdown: string): {
  contextMd: string;
  alternativesMd: string;
  decisionMd: string;
  consequencesMd: string;
} {
  const section = (names: string[]) => {
    const lines = markdown.split(/\r?\n/);
    let active = false;
    const collected: string[] = [];
    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        const heading = line
          .replace(/^#{1,6}\s+/, '')
          .trim()
          .toLocaleLowerCase();
        active = names.some(name => heading === name.toLocaleLowerCase());
        continue;
      }
      if (active) collected.push(line);
    }
    return collected.join('\n').trim();
  };
  return {
    contextMd: section(['Contexto', 'Context']),
    decisionMd: section(['Decisión', 'Decision']),
    alternativesMd: section(['Alternativas consideradas', 'Alternativas', 'Alternatives']),
    consequencesMd: section(['Consecuencias', 'Consequences']),
  };
}

export function nextDocumentNumber(documents: readonly ArtifactDocumentRecord[], prefix: 'DOC' | 'ADR'): number {
  if (prefix === 'ADR') return Math.max(0, ...documents.map(d => d.adrNumber ?? 0)) + 1;
  return (
    Math.max(
      0,
      ...documents.filter(d => d.displayKey.startsWith('DOC-')).map(d => Number(d.displayKey.slice(4)) || 0),
    ) + 1
  );
}
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'documento';
