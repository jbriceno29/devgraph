import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectSummaryDto } from '../../../shared/contracts/ipc-contracts.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import type { ShellView } from './next-step.js';
import { VIEWS, shortcutLabel, isMac } from './views.js';
import { ProjectTree } from './ProjectTree.js';
import { ThemeToggle } from './ThemeToggle.js';

export const tabId = (view: ShellView) => `vista-tab-${view}`;
export const panelId = (view: ShellView) => `vista-panel-${view}`;
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

interface SidebarProps {
  projects: ProjectSummaryDto[];
  activeProject: ProjectSummaryDto;
  onOpenProject(id: string): void;
  onRefreshProjects(): void;
  view: ShellView;
  onSelectView(view: ShellView): void;
  attentionCount: number /** Texto de la insignia de Inicio cuando falta responder o aprobar (null: sin insignia). */;
  inceptionBadge?: string | null;
  nodes: GraphNodeView[];
  selectedId: string | null;
  onSelectNode(id: string): void;
}

/** Barra lateral: proyecto, vistas (tablist con atajos), árbol del proyecto y tema. En < 900 px se pliega a iconos y se abre como panel superpuesto. */
export function Sidebar({
  projects,
  activeProject,
  onOpenProject,
  onRefreshProjects,
  view,
  onSelectView,
  attentionCount,
  inceptionBadge = null,
  nodes,
  selectedId,
  onSelectNode,
}: SidebarProps) {
  const [open, setOpen] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const narrowHidden = open ? '' : 'max-[900px]:hidden',
    narrowSr = open ? '' : 'max-[900px]:sr-only';
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const pick = (next: ShellView) => {
    onSelectView(next);
    setOpen(false);
  };
  const onTabKey = (event: KeyboardEvent, index: number) => {
    const last = VIEWS.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % VIEWS.length
        : event.key === 'ArrowUp'
          ? (index - 1 + VIEWS.length) % VIEWS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelectView(VIEWS[next]!.id);
    tabs.current[next]?.focus();
  };
  const keys = isMac() ? 'Meta' : 'Control';
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 hidden bg-fg/30 max-[900px]:block"
        />
      )}
      <aside
        aria-label="Barra lateral"
        className={`flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface-raised ${open ? 'max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:left-0 max-[900px]:z-40 max-[900px]:shadow-xl' : 'max-[900px]:w-16'}`}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
            className={`hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-sunken hover:text-fg max-[900px]:grid ${focusRing}`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
          <div
            aria-hidden="true"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-bold text-accent ${narrowHidden}`}
          >
            G
          </div>
          <div className={`min-w-0 ${narrowHidden}`}>
            <p className="truncate text-sm font-semibold text-fg">{activeProject.name}</p>
            <p className="font-mono text-[11px] text-fg-subtle">REV {activeProject.currentRevision}</p>
          </div>
        </div>
        <div className={`space-y-2 border-b border-border px-3 py-3 ${narrowHidden}`}>
          <label htmlFor="shell-project" className="block text-[11px] font-medium text-fg-subtle">
            Cambiar de proyecto
          </label>
          <select
            id="shell-project"
            aria-label="Proyecto activo"
            value={activeProject.id}
            onChange={event => onOpenProject(event.target.value)}
            className={`min-h-9 w-full rounded-lg border border-border bg-surface-sunken px-2 text-xs text-fg ${focusRing}`}
          >
            {[activeProject, ...projects.filter(project => project.id !== activeProject.id)].map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefreshProjects}
            className={`min-h-9 w-full rounded-lg px-2 text-left text-xs text-fg-muted hover:bg-surface-sunken hover:text-fg ${focusRing}`}
          >
            Actualizar proyectos
          </button>
        </div>
        <div
          role="tablist"
          aria-label="Vistas del proyecto"
          aria-orientation="vertical"
          className="space-y-0.5 px-2 py-3"
        >
          {VIEWS.map((info, index) => {
            const selected = info.id === view,
              count = info.id === 'activity' ? attentionCount : info.id === 'inception' && inceptionBadge ? 1 : 0,
              badge =
                info.id === 'inception'
                  ? inceptionBadge
                  : `${count} ${count === 1 ? 'pendiente' : 'pendientes'} de tu atención`;
            return (
              <button
                key={info.id}
                ref={element => {
                  tabs.current[index] = element;
                }}
                id={tabId(info.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId(info.id)}
                tabIndex={selected ? 0 : -1}
                aria-keyshortcuts={`${keys}+${index + 1}`}
                title={`${info.label} (${shortcutLabel(index)})`}
                onClick={() => pick(info.id)}
                onKeyDown={event => onTabKey(event, index)}
                className={`relative flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-sm ${focusRing} ${selected ? 'bg-accent-soft font-semibold text-fg' : 'text-fg-muted hover:bg-surface-sunken hover:text-fg'} ${open ? '' : 'max-[900px]:justify-center max-[900px]:px-0'}`}
              >
                <span className={selected ? 'text-accent' : ''}>{info.icon}</span>
                <span className={`flex-1 text-left ${narrowSr}`}>{info.label}</span>
                {count > 0 && (
                  <span
                    role="img"
                    aria-label={badge ?? ''}
                    className={`min-w-5 rounded-full bg-warning px-1.5 text-center text-[11px] font-semibold leading-5 text-surface ${open ? '' : 'max-[900px]:absolute max-[900px]:right-1 max-[900px]:top-0'}`}
                  >
                    {count}
                  </span>
                )}
                <kbd aria-hidden="true" className={`font-sans text-[11px] text-fg-subtle ${narrowHidden}`}>
                  {shortcutLabel(index)}
                </kbd>
              </button>
            );
          })}
        </div>
        <div className={`flex min-h-0 flex-1 flex-col border-t border-border ${narrowHidden}`}>
          <h2 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Proyecto</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <ProjectTree
              nodes={nodes}
              selectedId={selectedId}
              onSelect={id => {
                onSelectNode(id);
                setOpen(false);
              }}
            />
          </div>
        </div>
        <div className={`flex items-center justify-between gap-2 border-t border-border px-4 py-3 ${narrowHidden}`}>
          <span className="text-xs text-fg-muted">Tema</span>
          <ThemeToggle compact />
        </div>
      </aside>
    </>
  );
}
