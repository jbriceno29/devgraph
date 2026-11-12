import { useMemo, useState } from 'react';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';

const TREE_TYPES = new Set(['MODULE', 'FEATURE', 'WORK_ITEM']);
const order: Record<string, number> = { MODULE: 0, FEATURE: 1, WORK_ITEM: 2 };
export const STATUS_LOOK: Record<string, { label: string; dot: string }> = {
  DRAFT: { label: 'Borrador', dot: 'border border-status-draft' },
  READY: { label: 'Lista', dot: 'bg-status-ready' },
  BLOCKED: { label: 'Bloqueada', dot: 'bg-status-blocked' },
  IN_PROGRESS: { label: 'En curso', dot: 'bg-status-in-progress' },
  IN_REVIEW: { label: 'En revisión', dot: 'bg-status-in-review' },
  DONE: { label: 'Hecha', dot: 'bg-status-done' },
  ARCHIVED: { label: 'Archivada', dot: 'bg-status-archived' },
};
const typeLabel: Record<string, string> = { MODULE: 'Módulo', FEATURE: 'Feature', WORK_ITEM: 'Tarea' };
interface TreeNode {
  node: GraphNodeView;
  children: TreeNode[];
}

/** Construye módulos › features › tareas a partir de parentId (sin archivados). */
export function buildProjectTree(nodes: GraphNodeView[]): TreeNode[] {
  const kept = nodes.filter(node => TREE_TYPES.has(node.type) && node.status !== 'ARCHIVED');
  const byId = new Map(kept.map(node => [node.id, { node, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const entry of byId.values()) {
    const parent = entry.node.parentId ? byId.get(entry.node.parentId) : undefined;
    (parent ? parent.children : roots).push(entry);
  }
  const sort = (list: TreeNode[]) => {
    list.sort(
      (a, b) =>
        order[a.node.type]! - order[b.node.type]! || a.node.key.localeCompare(b.node.key, 'es', { numeric: true }),
    );
    list.forEach(item => sort(item.children));
    return list;
  };
  return sort(roots);
}

/** Árbol del proyecto en la barra lateral; elegir un nodo lo selecciona en el grafo y el inspector. */
export function ProjectTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: GraphNodeView[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const tree = useMemo(() => buildProjectTree(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!tree.length) return <p className="px-3 py-2 text-xs text-fg-subtle">Aún no hay módulos ni tareas.</p>;
  const render = (items: TreeNode[], depth: number) => (
    <ul className="space-y-px">
      {items.map(({ node, children }) => {
        const open = !collapsed.has(node.id),
          selected = node.id === selectedId,
          isTask = node.type === 'WORK_ITEM',
          look = STATUS_LOOK[node.status];
        const done = children.filter(child => child.node.type === 'WORK_ITEM'),
          progress =
            node.type === 'FEATURE' && done.length
              ? `${done.filter(child => child.node.status === 'DONE').length}/${done.length}`
              : '';
        return (
          <li key={node.id}>
            <div
              className={`group flex items-center rounded-md ${selected ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}
              style={{ paddingInlineStart: depth * 8 }}
            >
              {children.length ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? 'Contraer' : 'Expandir'} ${node.key}`}
                  onClick={() => toggle(node.id)}
                  className="grid h-9 w-6 shrink-0 place-items-center rounded text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    className={open ? 'rotate-90' : ''}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
              ) : (
                <span className="w-6 shrink-0" />
              )}
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(node.id)}
                className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md pe-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${selected ? 'font-semibold text-fg' : 'text-fg-muted group-hover:text-fg'}`}
              >
                {isTask ? (
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${look?.dot ?? 'bg-status-draft'}`}
                  />
                ) : null}
                <span className="sr-only">{typeLabel[node.type]} </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{node.key}</span>{' '}
                <span className="truncate">{node.label}</span>
                {isTask && <span className="sr-only">, estado: {look?.label ?? node.status}</span>}
                {progress && (
                  <>
                    <span aria-hidden="true" className="ms-auto shrink-0 text-[11px] text-fg-subtle">
                      {progress}
                    </span>
                    <span className="sr-only">, {progress.replace('/', ' de ')} tareas hechas</span>
                  </>
                )}
              </button>
            </div>
            {children.length > 0 && open && render(children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  return <nav aria-label="Árbol del proyecto">{render(tree, 0)}</nav>;
}
