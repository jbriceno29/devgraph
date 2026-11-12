import { useId, useState } from 'react';
import {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_NOTE,
  MAX_REFERENCES,
  MAX_REFERENCES_TOTAL_BYTES,
  REFERENCE_FILE_TYPES,
  type InceptionReferenceDto,
  type InceptionReferenceInput,
  type ReferenceKind,
} from '../../../shared/contracts/inception-view.js';
import { control, focusRing, secondary } from '../ui.js';

/** A file the user picked and described, waiting to be sent with the brief. */
export interface DraftReference extends InceptionReferenceInput {
  key: string;
  bytes: number;
}

export const KIND_LABEL: Record<ReferenceKind, string> = {
  VISUAL: 'Cómo debe verse',
  FUNCTIONAL: 'Qué debe hacer',
  CONCEPTUAL: 'Solo inspiración',
};
const KIND_HELP: Record<ReferenceKind, string> = {
  VISUAL: 'Colores, estilo y orden de la pantalla. Las funciones que aparezcan no se tomarán como requisitos.',
  FUNCTIONAL: 'Pantallas, acciones y recorridos que quieres conseguir.',
  CONCEPTUAL: 'La idea general; no se copiará su interfaz ni todas sus funciones.',
};
const ACCEPT = Object.keys(REFERENCE_FILE_TYPES)
  .map(extension => `.${extension}`)
  .join(',');
const IMAGE = /^(png|jpe?g|webp|gif)$/;
const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Base64 of a file, in chunks (spreading a whole file into `String.fromCharCode` overflows the stack). */
export async function readAsBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * Optional references for the brief. A separate model describes each file in text and the assistant works from that text, so each
 * file needs its purpose: how it should look, what it should do, or just inspiration.
 */
export function ReferencesField({
  value,
  onChange,
  disabled,
}: {
  value: DraftReference[];
  onChange(next: DraftReference[]): void;
  disabled?: boolean;
}) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const total = value.reduce((sum, item) => sum + item.bytes, 0);

  const add = async (files: FileList | null) => {
    setProblem(null);
    const picked = Array.from(files ?? []);
    if (!picked.length) return;
    if (value.length + picked.length > MAX_REFERENCES) {
      setProblem(`Puedes adjuntar como mucho ${MAX_REFERENCES} referencias.`);
      return;
    }
    const next = [...value];
    let running = total;
    for (const file of picked) {
      const extension = extensionOf(file.name);
      if (!REFERENCE_FILE_TYPES[extension]) {
        setProblem(`«${file.name}»: tipo no admitido. Usa ${Object.keys(REFERENCE_FILE_TYPES).join(', ')}.`);
        return;
      }
      if (file.size > MAX_REFERENCE_BYTES) {
        setProblem(`«${file.name}» pesa más de ${MAX_REFERENCE_BYTES / 1024 / 1024} MB.`);
        return;
      }
      if (running + file.size > MAX_REFERENCES_TOTAL_BYTES) {
        setProblem(`Las referencias no pueden sumar más de ${MAX_REFERENCES_TOTAL_BYTES / 1024 / 1024} MB.`);
        return;
      }
      running += file.size;
      next.push({
        key: `${Date.now()}-${next.length}-${file.name}`,
        name: file.name,
        bytes: file.size,
        kind: IMAGE.test(extension) ? 'VISUAL' : 'FUNCTIONAL',
        note: '',
        dataBase64: await readAsBase64(file),
      });
    }
    onChange(next);
  };
  const update = (key: string, patch: Partial<DraftReference>) =>
    onChange(value.map(item => (item.key === key ? { ...item, ...patch } : item)));

  return (
    <details className="rounded-lg border border-border bg-surface-sunken" open={value.length > 0 || undefined}>
      <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-accent ${focusRing}`}>
        Referencias (opcional)
        {value.length > 0 && (
          <span className="ml-2 text-xs font-normal text-fg-muted">
            {value.length} adjunta{value.length === 1 ? '' : 's'}
          </span>
        )}
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-xs leading-5 text-fg-muted">
          Capturas, bocetos, un prototipo HTML, un PDF o un documento. Un modelo aparte los describe en texto y el
          asistente trabaja con esa descripción: no ve tus archivos. Dile para qué sirve cada uno para que no confunda
          el estilo con el alcance.
        </p>
        <div>
          <label htmlFor={`${id}-files`} className="mb-1 block text-xs font-medium text-fg">
            Adjuntar archivos
          </label>
          <input
            id={`${id}-files`}
            type="file"
            multiple
            accept={ACCEPT}
            disabled={disabled || value.length >= MAX_REFERENCES}
            onChange={event => {
              void add(event.target.files);
              event.target.value = '';
            }}
            className={`${control} py-1.5 file:mr-3 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-xs file:text-accent`}
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            Hasta {MAX_REFERENCES} archivos, {MAX_REFERENCE_BYTES / 1024 / 1024} MB cada uno (
            {Object.keys(REFERENCE_FILE_TYPES).join(', ')}).
          </p>
          {problem && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {problem}
            </p>
          )}
        </div>
        {value.length > 0 && (
          <ul aria-label="Referencias adjuntas" className="space-y-2">
            {value.map(item => (
              <li key={item.key} className="space-y-2 rounded-lg border border-border bg-surface-raised p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-fg">
                    {item.name} <span className="font-normal text-fg-subtle">· {size(item.bytes)}</span>
                  </p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(value.filter(other => other.key !== item.key))}
                    aria-label={`Quitar ${item.name}`}
                    className={`min-h-8 text-xs ${secondary}`}
                  >
                    Quitar
                  </button>
                </div>
                <div>
                  <label htmlFor={`${id}-${item.key}-kind`} className="mb-1 block text-[11px] text-fg-muted">
                    ¿Para qué sirve?
                  </label>
                  <select
                    id={`${id}-${item.key}-kind`}
                    value={item.kind}
                    disabled={disabled}
                    onChange={event => update(item.key, { kind: event.target.value as ReferenceKind })}
                    aria-describedby={`${id}-${item.key}-help`}
                    className={`${control} max-w-xs`}
                  >
                    {(Object.keys(KIND_LABEL) as ReferenceKind[]).map(kind => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                  <p id={`${id}-${item.key}-help`} className="mt-1 text-[11px] text-fg-subtle">
                    {KIND_HELP[item.kind]}
                  </p>
                </div>
                <div>
                  <label htmlFor={`${id}-${item.key}-note`} className="mb-1 block text-[11px] text-fg-muted">
                    Qué conservar o evitar (opcional)
                  </label>
                  <input
                    id={`${id}-${item.key}-note`}
                    type="text"
                    maxLength={MAX_REFERENCE_NOTE}
                    value={item.note}
                    disabled={disabled}
                    onChange={event => update(item.key, { note: event.target.value })}
                    placeholder="Por ejemplo: me gusta la barra lateral; no quiero el modo oscuro"
                    className={control}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

const LIST_LABEL: Array<{ key: 'palette' | 'screens' | 'actions' | 'flows' | 'states' | 'ideas'; label: string }> = [
  { key: 'palette', label: 'Colores' },
  { key: 'screens', label: 'Pantallas' },
  { key: 'actions', label: 'Acciones' },
  { key: 'flows', label: 'Recorridos' },
  { key: 'states', label: 'Estados' },
  { key: 'ideas', label: 'Ideas' },
];

/** What the translator understood from each reference, so the user can check it before relying on it. */
export function ReferencesSummary({ references }: { references: InceptionReferenceDto[] }) {
  if (!references.length) return null;
  return (
    <details className="mb-4 rounded-lg border border-border bg-surface-sunken">
      <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs font-medium text-fg ${focusRing}`}>
        Cómo se entendieron tus referencias ({references.length})
      </summary>
      <ul className="space-y-3 border-t border-border p-3">
        {references.map(item => (
          <li key={item.id} className="space-y-1 text-xs leading-5 text-fg-muted">
            <p>
              <span className="font-medium text-fg">{item.name}</span> · {KIND_LABEL[item.kind]}
              {item.note && (
                <>
                  {' '}
                  · <span className="italic">{item.note}</span>
                </>
              )}
            </p>
            {item.status === 'TRANSLATED' && item.translation ? (
              <>
                <p>{item.translation.summary}</p>
                {item.translation.typography && (
                  <p>
                    <span className="font-medium text-fg">Tipografía:</span> {item.translation.typography}
                  </p>
                )}
                {item.translation.layout && (
                  <p>
                    <span className="font-medium text-fg">Composición:</span> {item.translation.layout}
                  </p>
                )}
                {LIST_LABEL.map(
                  ({ key, label }) =>
                    item.translation![key].length > 0 && (
                      <p key={key}>
                        <span className="font-medium text-fg">{label}:</span> {item.translation![key].join(' · ')}
                      </p>
                    ),
                )}
                {item.translation.openQuestions.length > 0 && (
                  <p>
                    <span className="font-medium text-fg">Por aclarar:</span>{' '}
                    {item.translation.openQuestions.join(' · ')}
                  </p>
                )}
              </>
            ) : (
              <p className={item.status === 'FAILED' ? 'text-danger' : ''}>
                {item.status === 'FAILED'
                  ? `No se pudo analizar: ${item.error ?? 'error desconocido'}`
                  : 'Pendiente de análisis.'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
