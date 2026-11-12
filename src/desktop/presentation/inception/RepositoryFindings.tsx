import { useId } from 'react';
import {
  MAX_REPOSITORY_CORRECTION,
  MAX_SCAN_BYTES,
  type InceptionRepositoryDto,
  type RepositoryInferenceArea,
  type RepositoryInferenceDto,
  type RepositoryScanSummaryDto,
} from '../../../shared/contracts/repository-scan.js';
import type { AgentAccessEditDto } from '../../../shared/contracts/repository-scan.js';
import { control, focusRing } from '../ui.js';
import { AgentAccessSection } from './AgentAccessSection.js';
import { CodeMapStatus } from './CodeMapStatus.js';

export const AREA_LABEL: Record<RepositoryInferenceArea, string> = {
  STACK: 'Stack',
  DESIGN_SYSTEM: 'Sistema de diseño',
  STRUCTURE: 'Estructura',
  TESTING: 'Pruebas',
};
const KIND_LABEL = { MANIFEST: 'manifiesto', STYLE: 'estilos', README: 'README', CI: 'integración continua' } as const;
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('es')} ${count === 1 ? one : many}`;

/** What the scan read and what it left out, in plain words (shared by the preview before starting and by the findings). */
export function ScanSummary({ scan }: { scan: RepositoryScanSummaryDto }) {
  const left = [
    scan.excluded.ignored &&
      `${plural(scan.excluded.ignored, 'entrada ignorada', 'entradas ignoradas')} por .gitignore`,
    scan.excluded.generated && `${plural(scan.excluded.generated, 'archivo', 'archivos')} de carpetas generadas`,
    scan.excluded.symlinks &&
      `${plural(scan.excluded.symlinks, 'enlace simbólico', 'enlaces simbólicos')} (no se siguen)`,
    scan.excluded.secrets &&
      `${plural(scan.excluded.secrets, 'posible secreto', 'posibles secretos')} (no se abrieron)`,
  ].filter((item): item is string => typeof item === 'string');
  return (
    <div className="space-y-2 text-xs leading-5 text-fg-muted">
      <p>
        <span className="font-medium text-fg">{scan.repositoryName}</span>:{' '}
        {plural(scan.totalFiles, 'archivo', 'archivos')}
        {scan.truncated ? ' (listado recortado)' : ''}
        {scan.languages.length > 0 && (
          <>
            {' '}
            ·{' '}
            {scan.languages
              .slice(0, 5)
              .map(item => `${item.language} (${item.files})`)
              .join(', ')}
          </>
        )}
        .
      </p>
      <p>
        Se leyeron {plural(scan.files.length, 'archivo', 'archivos')} ({kb(scan.bytes)} de {kb(MAX_SCAN_BYTES)} como
        máximo): manifiestos, estructura de carpetas y estilos. No se ejecutó nada.
      </p>
      {left.length > 0 && <p>Se dejó fuera: {left.join(' · ')}.</p>}
      {scan.files.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2 text-xs text-fg ${focusRing}`}>
            Archivos leídos ({scan.files.length})
          </summary>
          <ul className="space-y-0.5 border-t border-border px-3 py-2">
            {scan.files.map(file => (
              <li key={file.path}>
                <code className="font-mono text-fg">{file.path}</code> · {KIND_LABEL[file.kind]} · {kb(file.bytes)}
                {file.truncated ? ' · recortado' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {scan.warnings.length > 0 && (
        <ul className="list-disc pl-5">
          {scan.warnings.map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Brownfield mode: what was read from the repository and what the assistant inferred from it, each inference with its evidence. With `onCorrect`
 * every inference gets a field to correct it (the correction wins over the inference in every later step); without it, the corrections are shown.
 */
export function RepositoryFindings({
  repository,
  corrections,
  onCorrect,
  open = false,
  access,
  onAccessChange,
  projectId,
}: {
  repository: InceptionRepositoryDto;
  corrections?: Record<string, string>;
  onCorrect?(inferenceId: string, text: string): void;
  open?: boolean;
  /** The user's unsent edit of the agent's access (plan REP, R1). */
  access?: AgentAccessEditDto | null;
  onAccessChange?(edit: AgentAccessEditDto | null): void;
  /** Plan REP, R2: runs the verification baseline under the checks. */
  projectId?: string;
}) {
  const id = useId();
  const given = new Map(repository.corrections.map(item => [item.inferenceId, item.correction]));
  return (
    <details className="mb-4 rounded-lg border border-border bg-surface-sunken" open={open || undefined}>
      <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs font-medium text-fg ${focusRing}`}>
        Lo que se detectó en tu repositorio ({repository.inferences.length})
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <ScanSummary scan={repository.scan} />
        {repository.inferences.length === 0 ? (
          <p className="text-xs text-fg-muted">
            El asistente no pudo inferir nada con evidencia. Cuéntale en tus respuestas qué stack y qué estilos usa el
            proyecto.
          </p>
        ) : (
          <ul aria-label="Inferencias del repositorio" className="space-y-2">
            {repository.inferences.map(item => (
              <Inference
                key={item.id}
                item={item}
                value={corrections?.[item.id] ?? given.get(item.id) ?? ''}
                given={given.get(item.id)}
                {...(onCorrect ? { onCorrect: (text: string) => onCorrect(item.id, text) } : {})}
              />
            ))}
          </ul>
        )}
        <CodeMapStatus survey={repository.survey} />
        {repository.access && (
          <AgentAccessSection
            access={repository.access}
            {...(access !== undefined ? { edit: access } : {})}
            {...(onAccessChange ? { onChange: onAccessChange } : {})}
            {...(projectId ? { projectId } : {})}
          />
        )}
      </div>
    </details>
  );
}

function Inference({
  item,
  value,
  given,
  onCorrect,
}: {
  item: RepositoryInferenceDto;
  value: string;
  given: string | undefined;
  onCorrect?(text: string): void;
}) {
  const id = useId();
  return (
    <li className="rounded-lg border border-border bg-surface-raised p-3 text-xs leading-5">
      <p className="text-fg">
        <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">
          {AREA_LABEL[item.area]}
        </span>
        {item.statement}
      </p>
      <p className="mt-1 text-fg-muted">
        Evidencia:{' '}
        {item.evidence.map((path, index) => (
          <span key={path}>
            {index > 0 && ', '}
            <code className="font-mono text-fg">{path}</code>
          </span>
        ))}
      </p>
      {onCorrect ? (
        <div className="mt-2">
          <label htmlFor={id} className="mb-1 block text-[11px] text-fg-muted">
            ¿No es así? Corrígelo (opcional)
          </label>
          <input
            id={id}
            type="text"
            maxLength={MAX_REPOSITORY_CORRECTION}
            value={value}
            onChange={event => onCorrect(event.target.value)}
            placeholder="Por ejemplo: en realidad usamos Vue, no React"
            className={control}
          />
        </div>
      ) : (
        given && <p className="mt-1 font-medium text-fg">Tu corrección: {given}</p>
      )}
    </li>
  );
}
