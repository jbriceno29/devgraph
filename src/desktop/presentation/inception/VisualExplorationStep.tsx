import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { MAX_INCEPTION_NOTE, MAX_PROTOTYPE_CHARS, MAX_UI_OPTIONS, type InceptionIpcClient, type InceptionViewDto } from '../../../shared/contracts/inception-view.js';
import { errorText } from '../errors.js';
import { control, focusRing, primary, secondary } from '../ui.js';
import { hardenPrototype } from './harden-prototype.js';

/**
 * The prototype, running isolated: scripts yes (so it is interactive), network and the rest of the app no. `allow-forms` is needed because a sandbox
 * without it blocks forms entirely (their `submit` event never fires, so a prototype that adds items through a form looks broken); it is safe here because
 * the policy `form-action 'none'` stops any submission from going anywhere. No `allow-same-origin` (opaque origin), `allow-popups`, `allow-top-navigation` or `allow-modals`.
 */
export const PROTOTYPE_SANDBOX = 'allow-scripts allow-forms';
export function PrototypeFrame({ html }: { html: string }) {
  const srcDoc = useMemo(() => hardenPrototype(html), [html]);
  const [run, setRun] = useState(0);
  const key = `${run}:${srcDoc}`;
  // The document's own load is the first `load`; any later one means the prototype navigated its frame (a script setting `location`, or a form
  // submitting to itself and reloading). The policy cannot stop that, so the frame is dropped and the user told, instead of showing whatever loaded.
  const [loads, setLoads] = useState({ key: '', count: 0 });
  const navigated = loads.key === key && loads.count > 1;
  if (navigated) return <div role="alert" className="grid h-[26rem] place-items-center rounded-lg border border-warning/50 bg-warning-soft p-6 text-center text-xs text-fg"><div className="space-y-3"><p>El prototipo intentó salir de su página o recargarse (por ejemplo, un formulario que se envía sin cancelar el envío). Se detuvo para que no cargue nada de fuera.</p><button type="button" onClick={() => setRun(count => count + 1)} className={`min-h-9 text-sm ${secondary}`}>Reiniciar la vista previa</button></div></div>;
  return <iframe key={key} title="Vista previa del prototipo" sandbox={PROTOTYPE_SANDBOX} referrerPolicy="no-referrer" srcDoc={srcDoc} onLoad={() => setLoads(current => ({ key, count: current.key === key ? current.count + 1 : 1 }))} className="h-[26rem] w-full rounded-lg border border-border-strong bg-white" />;
}

interface Props {
  client: InceptionIpcClient; projectId: string; view: InceptionViewDto; heading: RefObject<HTMLHeadingElement | null>; busy: boolean; eyebrow: string;
  onChoose(optionId: string | null): void; onRevise(optionId: string, notes: string): void; onImport(name: string, html: string): void;
}

const card = 'rounded-xl border border-border bg-surface-raised p-5';

/** Design directions with their prototypes: look at each, ask for changes, import one made elsewhere, approve one or skip the design. */
export function VisualExplorationStep({ client, projectId, view, heading, busy, eyebrow, onChoose, onRevise, onImport }: Props) {
  const id = useId();
  const { options } = view.ui;
  const [selectedId, setSelectedId] = useState<string>(() => view.ui.selectedOptionId ?? options[0]?.id ?? '');
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null), [loadError, setLoadError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false), [notes, setNotes] = useState('');
  const [pasted, setPasted] = useState(''), [name, setName] = useState('Prototipo importado'), [importError, setImportError] = useState<string | null>(null);
  const known = useRef(options.length);
  const selected = options.find(option => option.id === selectedId) ?? options[0];

  // A new direction (imported) becomes the selected one.
  useEffect(() => { if (options.length > known.current) setSelectedId(options[options.length - 1]!.id); known.current = options.length; }, [options]);
  // The prototype's HTML is fetched apart from the view (it is polled); refetched when the view changes (an adjustment keeps the id).
  const key = `${selected?.id ?? ''}:${view.updatedAt ?? ''}`;
  useEffect(() => {
    if (!selected) return;
    let live = true; setLoadError(null);
    void client.getUiPrototype(projectId, selected.id).then(value => { if (live) setHtml({ key, value }); }).catch(reason => { if (live) setLoadError(errorText(reason)); });
    return () => { live = false; };
  }, [client, projectId, selected?.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) { setImportError('Sube el archivo .html del prototipo.'); return; }
    if (file.size > MAX_PROTOTYPE_CHARS * 4) { setImportError(`«${file.name}» es demasiado grande.`); return; }
    const text = await file.text();
    if (text.length > MAX_PROTOTYPE_CHARS) { setImportError(`«${file.name}» supera los ${MAX_PROTOTYPE_CHARS.toLocaleString('es')} caracteres.`); return; }
    onImport(file.name, text);
  };

  return <section aria-labelledby={`${id}-title`} className={card}>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
    <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="mt-1 text-base font-semibold text-fg focus:outline-none">Elige una dirección visual</h2>
    <p className="mt-1 text-sm text-fg-muted">Prueba cada prototipo: funciona sin Internet y no tiene acceso a tus datos ni al resto de la app. Pide ajustes, importa uno que hayas hecho en otra herramienta, y aprueba el que más te guste. Aprobar una dirección fija el estilo; el plan lo apruebas en el siguiente paso.</p>
    {view.error && <p role="alert" className="mt-3 rounded-lg border border-danger/50 bg-danger-soft p-3 text-xs text-danger">{view.error}</p>}

    <fieldset className="mt-4">
      <legend className="mb-2 text-xs font-medium text-fg">Direcciones ({options.length})</legend>
      <div className="grid gap-2 sm:grid-cols-2">{options.map(option => {
        const checked = option.id === selected?.id;
        return <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? 'border-accent bg-accent-soft text-fg' : 'border-border bg-surface-sunken text-fg-muted hover:border-border-strong hover:text-fg'}`}>
          <input type="radio" name={`${id}-option`} checked={checked} onChange={() => { setSelectedId(option.id); setAdjusting(false); }} className="mt-0.5 accent-[var(--accent)]" />
          <span className="flex-1"><span className="font-medium text-fg">{option.title}</span>{option.source === 'IMPORTED' && <span className="ml-2 rounded bg-warning-soft px-1.5 text-[11px] font-medium text-warning">Importada</span>}<span className="mt-0.5 block leading-4">{option.summary}</span></span>
        </label>;
      })}</div>
    </fieldset>

    {selected && <div className="mt-4 space-y-3">
      <PrototypeSlot html={html?.key === key ? html.value : null} error={loadError} />
      {selected.externalReferences.length > 0 && <p role="status" className="rounded-lg border border-warning/50 bg-warning-soft p-2 text-xs text-fg">Este prototipo intenta usar recursos externos ({selected.externalReferences.join(', ')}). No se cargarán: se muestra sin Internet.</p>}
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        {selected.navigation && <><dt className="font-medium text-fg">Navegación</dt><dd className="text-fg-muted">{selected.navigation}</dd></>}
        {selected.screens.length > 0 && <><dt className="font-medium text-fg">Pantallas</dt><dd className="text-fg-muted">{selected.screens.join(' · ')}</dd></>}
        {selected.designSystemNotes.length > 0 && <><dt className="font-medium text-fg">Sistema de diseño</dt><dd><ul className="list-disc space-y-0.5 pl-4 text-fg-muted">{selected.designSystemNotes.map(note => <li key={note}>{note}</li>)}</ul></dd></>}
      </dl>
      {adjusting && <div className="space-y-2 rounded-lg border border-border bg-surface-sunken p-3">
        <label htmlFor={`${id}-notes`} className="block text-xs font-medium text-fg">¿Qué quieres cambiar de este prototipo?</label>
        <textarea id={`${id}-notes`} rows={3} maxLength={MAX_INCEPTION_NOTE} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Por ejemplo: barra lateral más angosta, tarjetas con menos sombra y un estado vacío con ilustración" className={`${control} py-2 text-sm`} />
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !notes.trim()} onClick={() => { onRevise(selected.id, notes.trim()); setNotes(''); setAdjusting(false); }} className={`min-h-9 text-sm ${primary}`}>Regenerar este prototipo</button><button type="button" onClick={() => setAdjusting(false)} className={`min-h-9 text-sm ${secondary}`}>Cancelar</button></div>
      </div>}
    </div>}

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={busy || !selected} onClick={() => selected && onChoose(selected.id)} className={`min-h-9 text-sm ${primary}`}>Aprobar esta dirección visual y preparar el plan</button>
      <button type="button" disabled={busy || !selected} aria-expanded={adjusting} onClick={() => setAdjusting(value => !value)} className={`min-h-9 text-sm ${secondary}`}>Pedir ajustes a este prototipo</button>
      <button type="button" disabled={busy} onClick={() => onChoose(null)} className={`min-h-9 text-sm ${secondary}`}>Saltar el diseño e ir directo al plan</button>
    </div>

    <details className="mt-5 rounded-lg border border-border bg-surface-sunken">
      <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-accent ${focusRing}`}>Importar un prototipo hecho en otra herramienta (HTML)</summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-xs leading-5 text-fg-muted">Descarga o exporta el HTML desde Claude Artifacts, Claude Design u otra herramienta y súbelo o pégalo aquí. Se añade como una dirección más ({options.length} de {MAX_UI_OPTIONS}); podrás pedir que el asistente lo ajuste. Si el prototipo carga recursos de Internet, no se cargarán.</p>
        <div><label htmlFor={`${id}-file`} className="mb-1 block text-xs font-medium text-fg">Subir un archivo .html</label><input id={`${id}-file`} type="file" accept=".html,.htm,text/html" disabled={busy || options.length >= MAX_UI_OPTIONS} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} className={`${control} py-1.5 file:mr-3 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-xs file:text-accent`} /></div>
        <div><label htmlFor={`${id}-paste`} className="mb-1 block text-xs font-medium text-fg">O pegar el HTML</label><textarea id={`${id}-paste`} rows={4} value={pasted} onChange={event => { setPasted(event.target.value); setImportError(null); }} spellCheck={false} className={`${control} py-2 font-mono text-[11px]`} /></div>
        <div><label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-fg">Nombre</label><input id={`${id}-name`} type="text" maxLength={80} value={name} onChange={event => setName(event.target.value)} className={`${control} max-w-xs`} /></div>
        {importError && <p role="alert" className="text-xs text-danger">{importError}</p>}
        <button type="button" disabled={busy || !pasted.trim() || options.length >= MAX_UI_OPTIONS} onClick={() => { if (pasted.length > MAX_PROTOTYPE_CHARS) { setImportError(`El HTML supera los ${MAX_PROTOTYPE_CHARS.toLocaleString('es')} caracteres.`); return; } onImport(name.trim() || 'Prototipo importado', pasted); setPasted(''); }} className={`min-h-9 text-sm ${secondary}`}>Importar el HTML pegado</button>
      </div>
    </details>
  </section>;
}

function PrototypeSlot({ html, error }: { html: string | null; error: string | null }) {
  if (error) return <p role="alert" className="text-xs text-danger">No se pudo cargar el prototipo: {error}</p>;
  if (html === null) return <p role="status" className="grid h-[26rem] place-items-center rounded-lg border border-border bg-surface-sunken text-xs text-fg-muted">Cargando el prototipo…</p>;
  return <PrototypeFrame html={html} />;
}
