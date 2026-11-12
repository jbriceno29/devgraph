import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { GraphEdgeType, GraphNodeView, KnowledgeEntityType } from '../../../shared/contracts/graph-view.js';
import type { ContextFlowDto, GraphEdgeView } from '../../../shared/contracts/graph-view.js';
import { layoutGraph } from './graph-layout.js';
import { AUTHORITY_TIER, ENTITY_LABEL, EDGE_LABEL, statusLabel } from '../labels.js';

const nodeTypes: KnowledgeEntityType[] = [
  'PROJECT_ROOT',
  'MODULE',
  'FEATURE',
  'REQUIREMENT',
  'WORK_ITEM',
  'MILESTONE',
  'DECISION_RECORD',
  'ARTIFACT',
  'CODE_REFERENCE',
];
const edgeTypes: GraphEdgeType[] = [
  'DEPENDS_ON',
  'IMPLEMENTS',
  'SATISFIES',
  'AFFECTS',
  'SUPERSEDES',
  'DOCUMENTED_BY',
  'VERIFIED_BY',
  'TOUCHES_CODE',
  'MODIFIES',
  'GENERATED_BY',
  'SCOPED_IN',
];
/** Token de color de cada tipo (`--node-<token>-fill|stroke` en theme/tokens.css). */
const tones: Record<KnowledgeEntityType, string> = {
  PROJECT_ROOT: 'project-root',
  MODULE: 'module',
  FEATURE: 'feature',
  REQUIREMENT: 'requirement',
  WORK_ITEM: 'work-item',
  MILESTONE: 'milestone',
  DECISION_RECORD: 'decision-record',
  ARTIFACT: 'artifact',
  CODE_REFERENCE: 'code-reference',
};
const fill = (type: KnowledgeEntityType) => `var(--node-${tones[type]}-fill)`,
  stroke = (type: KnowledgeEntityType) => `var(--node-${tones[type]}-stroke)`;
interface GraphCanvasProps {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  ghostNodes?: GraphNodeView[];
  ghostEdges?: GraphEdgeView[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** What is visible. The filter only hides things on this canvas: the shell's graph stays whole. */
  filter?: GraphCanvasFilter;
  /** Lets the owner keep the filter when the view unmounts (switching tabs). */
  onFilterChange?(filter: GraphCanvasFilter): void;
  projectId?: string;
}
export interface GraphCanvasFilter {
  nodeTypes: KnowledgeEntityType[];
  edgeTypes: GraphEdgeType[];
}
export const FULL_GRAPH_FILTER: GraphCanvasFilter = { nodeTypes, edgeTypes };
/** Estado vivo (etapa 6): lo que corre late, lo hecho se asienta, lo que espera se atenúa. `token` es `--status-<token>`. */
const statusLook: Record<string, { token: string; label: string; live?: boolean; dim?: boolean }> = {
  READY: { token: 'ready', label: 'LISTA' },
  IN_PROGRESS: { token: 'in-progress', label: 'EN CURSO', live: true },
  IN_REVIEW: { token: 'in-review', label: 'EN REVISIÓN' },
  DONE: { token: 'done', label: '✓ HECHA', dim: true },
  BLOCKED: { token: 'blocked', label: 'BLOQUEADA', dim: true },
  DRAFT: { token: 'draft', label: 'BORRADOR' },
  ARCHIVED: { token: 'archived', label: 'ARCHIVADA', dim: true },
  REMOVED: { token: 'archived', label: 'ELIMINADO', dim: true },
};
const statusColor = (look: { token: string }) => `var(--status-${look.token})`;
/** Niveles de autoridad del contexto que recibió una tarea (reglas, decisiones, especificación, código, historial). */
const tierColor = (tier: number) => (tier >= 1 && tier <= 5 ? `var(--tier-${tier})` : 'var(--context)');
const tierLook = (tier: number) => `${tier} · ${AUTHORITY_TIER[tier] ?? 'otro'}`;
const NODE_W = 180,
  NODE_H = 96,
  PAD = 40,
  MIN_ZOOM = 0.25,
  MAX_ZOOM = 2,
  STEP = 1.2;
const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
/** Parte un título en dos líneas por palabras; recorta con «…» solo lo que no cabe en la segunda. */
export function wrapTitle(label: string, max = 22): [string, string] {
  const words = label.trim().split(/\s+/);
  let first = '';
  let index = 0;
  for (; index < words.length; index++) {
    const next = first ? `${first} ${words[index]}` : words[index]!;
    if (next.length > max) break;
    first = next;
  }
  if (!first) {
    const word = words[0] ?? '';
    return [word.slice(0, max), cut(`${word.slice(max)} ${words.slice(1).join(' ')}`.trim(), max)];
  }
  return [first, cut(words.slice(index).join(' '), max)];
}
const cut = (text: string, max: number) => {
  if (text.length <= max) return text;
  let out = '';
  for (const word of text.split(' ')) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max - 1) break;
    out = next;
  }
  return `${out || text.slice(0, max - 1)}…`;
};
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function GraphCanvas({
  nodes,
  edges,
  ghostNodes = [],
  ghostEdges = [],
  selectedId,
  onSelect,
  filter = FULL_GRAPH_FILTER,
  onFilterChange,
  projectId,
}: GraphCanvasProps) {
  const [pilots, setPilots] = useState<Map<string, string>>(() => new Map()),
    [flow, setFlow] = useState<ContextFlowDto | null>(null),
    [showFlow, setShowFlow] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null),
    [hoverEdge, setHoverEdge] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null),
    anchor = useRef<{ x: number; y: number } | null>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null),
    fitted = useRef<string | null>(null);
  // Actividad del piloto automático por feature, tal como la informa el núcleo.
  useEffect(
    () =>
      window.workspaceIpc?.events?.onPilotUpdated?.(event => {
        if (projectId && event.projectId !== projectId) return;
        setPilots(previous => new Map(previous).set(event.featureId, event.status ?? ''));
      }),
    [projectId],
  );
  const selectedNode = nodes.find(node => node.id === selectedId) ?? null;
  // El contexto que recibió la última ejecución de la tarea elegida: qué entidades y con qué nivel de autoridad.
  useEffect(() => {
    let current = true;
    setFlow(null);
    const query = window.workspaceIpc?.queries?.getContextFlow;
    if (!projectId || !query || selectedNode?.type !== 'WORK_ITEM') return;
    void Promise.resolve(query(projectId, selectedNode.id))
      .then(result => {
        if (current && result) setFlow(result);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [projectId, selectedNode?.id, selectedNode?.type, selectedNode?.status]);
  const progress = useMemo(() => {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const totals = new Map<string, { done: number; total: number }>();
    for (const node of nodes) {
      if (node.type !== 'WORK_ITEM' || node.status === 'ARCHIVED') continue;
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent?.type === 'WORK_ITEM') parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      if (parent?.type !== 'FEATURE') continue;
      const entry = totals.get(parent.id) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (node.status === 'DONE') entry.done += 1;
      totals.set(parent.id, entry);
    }
    return totals;
  }, [nodes]);
  const flowTier = new Map((showFlow && flow ? flow.sources : []).map(source => [source.entityId, source.tier]));
  const [visibleNodes, setVisibleNodes] = useState<Set<KnowledgeEntityType>>(() => new Set(filter.nodeTypes)),
    [visibleEdges, setVisibleEdges] = useState<Set<GraphEdgeType>>(() => new Set(filter.edgeTypes)),
    [filtersOpen, setFiltersOpen] = useState(false);
  const displayNodes = [...nodes, ...ghostNodes],
    displayEdges = [...edges, ...ghostEdges];
  const ghostIds = new Set(ghostNodes.map(node => node.id)),
    ghostEdgeIds = new Set(ghostEdges.map(edge => edge.id));
  const positions = useMemo(() => layoutGraph(displayNodes), [nodes, ghostNodes]);
  const pointById = new Map(positions.map(p => [p.node.id, p]));
  const minX = Math.min(0, ...positions.map(p => p.x)),
    maxX = Math.max(0, ...positions.map(p => p.x)),
    maxY = Math.max(0, ...positions.map(p => p.y));
  const viewW = maxX - minX + NODE_W + PAD * 2,
    viewH = maxY + NODE_H + PAD * 2 + 48,
    viewLeft = minX - PAD,
    viewTop = -PAD - 24;
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  };
  const updateNode = (type: KnowledgeEntityType) => {
    const next = toggle(visibleNodes, type);
    setVisibleNodes(next);
    onFilterChange?.({ nodeTypes: [...next], edgeTypes: [...visibleEdges] });
  };
  const updateEdge = (type: GraphEdgeType) => {
    const next = toggle(visibleEdges, type);
    setVisibleEdges(next);
    onFilterChange?.({ nodeTypes: [...visibleNodes], edgeTypes: [...next] });
  };
  const shownIds = new Set(displayNodes.filter(node => visibleNodes.has(node.type)).map(node => node.id));
  const hidden = nodeTypes.length - visibleNodes.size + edgeTypes.length - visibleEdges.size;

  /** Cambia el zoom manteniendo fijo el punto central de la vista (o el del cursor con la rueda). */
  const zoomTo = useCallback((next: number | ((current: number) => number), at?: { x: number; y: number }) => {
    const el = viewport.current;
    if (el && el.scrollWidth) {
      const x = at?.x ?? el.clientWidth / 2,
        y = at?.y ?? el.clientHeight / 2;
      anchor.current = { x: (el.scrollLeft + x) / el.scrollWidth, y: (el.scrollTop + y) / el.scrollHeight };
    }
    setZoom(current => clamp(typeof next === 'function' ? next(current) : next));
  }, []);
  const fit = useCallback(
    (cap = 1.5, floor = MIN_ZOOM) => {
      const el = viewport.current;
      if (!el || !el.clientWidth || !el.clientHeight) return false;
      anchor.current = null;
      setZoom(clamp(Math.max(floor, Math.min(cap, (el.clientWidth - 8) / viewW, (el.clientHeight - 8) / viewH))));
      requestAnimationFrame(() => el.scrollTo?.({ left: 0, top: 0 }));
      return true;
    },
    [viewW, viewH],
  );
  useLayoutEffect(() => {
    const el = viewport.current,
      point = anchor.current;
    if (!el || !point) return;
    anchor.current = null;
    el.scrollLeft = point.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = point.y * el.scrollHeight - el.clientHeight / 2;
  }, [zoom]);
  // Al abrir un proyecto, si el grafo no cabe, se ajusta a la vista sin pasar del 100 % ni bajar del 60 % (por debajo no se lee; se desplaza).
  useLayoutEffect(() => {
    const key = projectId ?? 'local';
    if (fitted.current === key || !nodes.length) return;
    const el = viewport.current;
    if (!el?.clientWidth) return;
    fitted.current = key;
    if (viewW > el.clientWidth || viewH > el.clientHeight) fit(1, 0.6);
  }, [projectId, nodes.length, viewW, viewH, fit]);
  // Ctrl/⌘ + rueda = zoom (la rueda sola desplaza); necesita un listener no pasivo para evitar el zoom de la página.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = el.getBoundingClientRect();
      zoomTo(current => current * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest?.('[data-node],button')) return;
    const el = viewport.current;
    if (!el) return;
    drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, id: event.pointerId };
    el.setPointerCapture?.(event.pointerId);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current,
      el = viewport.current;
    if (!state || !el) return;
    el.scrollLeft = state.left - (event.clientX - state.x);
    el.scrollTop = state.top - (event.clientY - state.y);
  };
  const endPan = () => {
    const state = drag.current;
    drag.current = null;
    if (state) viewport.current?.releasePointerCapture?.(state.id);
  };
  const onCanvasKey = (event: ReactKeyboardEvent) => {
    if (event.target !== viewport.current) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomTo(z => z * STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomTo(z => z / STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      fit();
    }
  };
  const headingId = useId();
  const focusIds = new Set([selectedId, hoverId].filter(Boolean) as string[]);

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-fg">
            Grafo del proyecto
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">Jerarquía y relaciones entre módulos, features y tareas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {flow && flow.sources.length > 0 && (
            <button
              type="button"
              aria-pressed={showFlow}
              className={`min-h-9 rounded-lg border border-context-border px-3 text-xs text-context hover:bg-context-soft ${focusRing}`}
              onClick={() => setShowFlow(value => !value)}
            >
              {showFlow ? 'Ocultar contexto' : 'Ver contexto'} · {flow.sources.length}
            </button>
          )}
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="graph-filters"
            className={`min-h-9 rounded-lg border border-border-strong px-3 text-xs text-fg-muted hover:text-fg ${focusRing}`}
            onClick={() => setFiltersOpen(v => !v)}
          >
            {filtersOpen ? 'Cerrar filtros' : 'Filtros'}
            {hidden > 0 ? ` · ${hidden} ocultos` : ''}
          </button>
        </div>
      </div>
      {filtersOpen && (
        <div
          id="graph-filters"
          className="grid gap-4 border-b border-border bg-surface-sunken px-4 py-3 lg:grid-cols-2"
        >
          <FilterGroup
            title="Tipos de elemento"
            items={nodeTypes}
            selected={visibleNodes}
            label={type => ENTITY_LABEL[type]}
            onToggle={updateNode}
          />
          <FilterGroup
            title="Relaciones"
            items={edgeTypes}
            selected={visibleEdges}
            label={type => EDGE_LABEL[type].replace(/^./, first => first.toUpperCase())}
            onToggle={updateEdge}
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={viewport}
          tabIndex={0}
          role="region"
          aria-label="Lienzo del grafo (+ y − para el zoom, 0 para ajustar)"
          onKeyDown={onCanvasKey}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          className="absolute inset-0 cursor-grab overflow-auto bg-[radial-gradient(var(--grid-dot)_0.7px,transparent_0.7px)] [background-size:22px_22px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
        >
          <div className="flex min-h-full w-max min-w-full items-center justify-center">
            <svg
              data-zoom={zoom}
              width={Math.round(viewW * zoom)}
              height={Math.round(viewH * zoom)}
              viewBox={`${viewLeft} ${viewTop} ${viewW} ${viewH}`}
              role="group"
              aria-label="Elementos del grafo"
              className="shrink-0 select-none"
            >
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" style={{ fill: 'var(--edge-cross)' }} />
                </marker>
                <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" style={{ fill: 'var(--accent)' }} />
                </marker>
                <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" style={{ fill: 'var(--context)' }} />
                </marker>
              </defs>
              {selectedId &&
                [...flowTier].map(([entityId, tier]) => {
                  const a = pointById.get(entityId),
                    b = pointById.get(selectedId);
                  if (!a || !b || !visibleNodes.has(a.node.type)) return null;
                  const fromX = a.x + NODE_W / 2,
                    fromY = a.y + NODE_H / 2,
                    toX = b.x + NODE_W / 2,
                    toY = b.y + NODE_H / 2;
                  return (
                    <path
                      key={`flow-${entityId}`}
                      data-context-flow={entityId}
                      className="pointer-events-none"
                      d={`M ${fromX} ${fromY} Q ${(fromX + toX) / 2} ${Math.min(fromY, toY) - 60}, ${toX} ${toY}`}
                      fill="none"
                      style={{ stroke: tierColor(tier) }}
                      strokeWidth="1.6"
                      strokeDasharray="2 5"
                      opacity="0.9"
                      markerEnd="url(#flow-arrow)"
                    />
                  );
                })}
              {displayEdges
                .filter(edge => visibleEdges.has(edge.type) && shownIds.has(edge.source) && shownIds.has(edge.target))
                .map(edge => {
                  const a = pointById.get(edge.source),
                    b = pointById.get(edge.target);
                  if (!a || !b) return null;
                  const ghost = ghostEdgeIds.has(edge.id),
                    fromX = a.x + NODE_W / 2,
                    fromY = a.y + NODE_H / 2,
                    toX = b.x + NODE_W / 2,
                    toY = b.y + NODE_H / 2;
                  const cross =
                    edge.type !== 'SCOPED_IN' && edge.type !== 'DOCUMENTED_BY' && edge.type !== 'IMPLEMENTS';
                  const active = hoverEdge === edge.id || focusIds.has(edge.source) || focusIds.has(edge.target);
                  const d = `M ${fromX} ${fromY} C ${fromX + 55} ${fromY}, ${toX + 55} ${toY}, ${toX} ${toY}`;
                  const text = `${ghost ? 'Propuesta · ' : ''}${EDGE_LABEL[edge.type] ?? edge.type}`;
                  return (
                    <g key={edge.id} data-edge={edge.type}>
                      <path
                        d={d}
                        fill="none"
                        className="pointer-events-none"
                        style={{
                          stroke: ghost
                            ? 'var(--node-ghost-stroke)'
                            : active
                              ? 'var(--accent)'
                              : cross
                                ? 'var(--edge-cross)'
                                : 'var(--edge)',
                        }}
                        strokeWidth={ghost ? 2.3 : active ? 2.2 : cross ? 1.8 : 1.3}
                        strokeDasharray={ghost || cross ? '5 5' : undefined}
                        markerEnd={active && !ghost ? 'url(#arrow-active)' : 'url(#arrow)'}
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="12"
                        style={{ pointerEvents: 'stroke' }}
                        onMouseEnter={() => setHoverEdge(edge.id)}
                        onMouseLeave={() => setHoverEdge(current => (current === edge.id ? null : current))}
                      >
                        <title>{`${a.node.label} ${text} ${b.node.label}`}</title>
                      </path>
                      {active && (
                        <text
                          x={(fromX + toX) / 2 + 41}
                          y={(fromY + toY) / 2 - 6}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="600"
                          className="pointer-events-none"
                          style={{
                            fill: ghost ? 'var(--node-ghost-stroke)' : 'var(--edge-label)',
                            stroke: 'var(--surface-raised)',
                            strokeWidth: 4,
                            paintOrder: 'stroke',
                            strokeLinejoin: 'round',
                          }}
                        >
                          {text}
                        </text>
                      )}
                    </g>
                  );
                })}
              {positions
                .filter(({ node }) => visibleNodes.has(node.type))
                .map(({ node, x, y }) => {
                  const active = selectedId === node.id,
                    ghost = ghostIds.has(node.id),
                    look = ghost ? undefined : statusLook[node.status],
                    tier = flowTier.get(node.id),
                    totals = node.type === 'FEATURE' ? progress.get(node.id) : undefined,
                    pilot = node.type === 'FEATURE' ? pilots.get(node.id) : undefined,
                    piloting = pilot === 'RUNNING' || pilot === 'PAUSED';
                  const [line1, line2] = wrapTitle(node.label);
                  const accent = ghost ? 'var(--node-ghost-stroke)' : stroke(node.type);
                  return (
                    <g
                      key={node.id}
                      data-node=""
                      transform={`translate(${x},${y})`}
                      role={ghost ? undefined : 'button'}
                      tabIndex={ghost ? -1 : 0}
                      aria-pressed={ghost ? undefined : active}
                      aria-label={`${ghost ? 'Propuesta: ' : ''}${ENTITY_LABEL[node.type] ?? node.type}: ${node.label}`}
                      data-status={node.status}
                      data-live={look?.live ? 'true' : undefined}
                      data-context-tier={tier}
                      onClick={() => !ghost && onSelect(node.id)}
                      onKeyDown={event => {
                        if (!ghost && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          onSelect(node.id);
                        }
                      }}
                      onMouseEnter={() => setHoverId(node.id)}
                      onMouseLeave={() => setHoverId(current => (current === node.id ? null : current))}
                      onFocus={() => setHoverId(node.id)}
                      onBlur={() => setHoverId(current => (current === node.id ? null : current))}
                      className={ghost ? 'pointer-events-none' : 'cursor-pointer'}
                      opacity={ghost ? 0.8 : look?.dim && !active && tier === undefined ? 0.62 : 1}
                    >
                      <title>{`${node.key} · ${node.label}`}</title>
                      {tier !== undefined && (
                        <rect
                          x="-5"
                          y="-5"
                          width={NODE_W + 10}
                          height={NODE_H + 10}
                          rx="15"
                          fill="none"
                          style={{ stroke: tierColor(tier) }}
                          strokeWidth="2"
                          strokeDasharray="4 3"
                        />
                      )}
                      {look?.live && (
                        <rect
                          x="-3"
                          y="-3"
                          width={NODE_W + 6}
                          height={NODE_H + 6}
                          rx="14"
                          fill="none"
                          style={{ stroke: statusColor(look) }}
                          strokeWidth="2"
                        >
                          <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
                        </rect>
                      )}
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx="12"
                        style={{
                          fill: ghost ? 'var(--node-ghost-fill)' : fill(node.type),
                          stroke: ghost
                            ? 'var(--node-ghost-stroke)'
                            : active
                              ? 'var(--node-selected)'
                              : look && node.type === 'WORK_ITEM'
                                ? statusColor(look)
                                : stroke(node.type),
                        }}
                        strokeWidth={ghost ? 2.2 : active ? 2.8 : hoverId === node.id ? 2.2 : 1.5}
                        strokeDasharray={ghost ? '7 4' : undefined}
                      />
                      <text x="14" y="22" fontSize="11" fontWeight="700" letterSpacing="0.5" style={{ fill: accent }}>
                        {node.key} · {(ENTITY_LABEL[node.type] ?? node.type).toUpperCase()}
                      </text>
                      <text x="14" y="44" fontSize="13" fontWeight="600" style={{ fill: 'var(--node-fg)' }}>
                        <tspan x="14">{line1}</tspan>
                        {line2 && (
                          <tspan x="14" dy="17">
                            {line2}
                          </tspan>
                        )}
                      </text>
                      {totals ? (
                        <text
                          x="14"
                          y="84"
                          fontSize="11"
                          style={{ fill: totals.done === totals.total ? 'var(--status-done)' : stroke('FEATURE') }}
                        >
                          {totals.done}/{totals.total} tareas{piloting ? ' · ' : ''}
                          {piloting && (
                            <tspan fontWeight="700" style={{ fill: 'var(--pilot)' }}>
                              {pilot === 'PAUSED' ? 'PILOTO EN PAUSA' : 'PILOTO'}
                            </tspan>
                          )}
                        </text>
                      ) : (
                        <text
                          x="14"
                          y="84"
                          fontSize="11"
                          fontWeight={look || ghost ? '600' : undefined}
                          style={{
                            fill: ghost ? 'var(--node-ghost-stroke)' : look ? statusColor(look) : 'var(--fg-muted)',
                          }}
                        >
                          {ghost ? 'PROPUESTA' : (look?.label ?? statusLabel(node.status).toUpperCase())}
                        </text>
                      )}
                    </g>
                  );
                })}
            </svg>
          </div>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-fg-muted">
              Este proyecto aún no tiene elementos en el grafo. Empieza en Planificar.
            </div>
          )}
        </div>
        <div
          role="toolbar"
          aria-label="Zoom del grafo"
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl border border-border bg-surface-raised p-1 shadow-md"
        >
          <button
            type="button"
            aria-label="Alejar"
            title="Alejar (−)"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomTo(z => z / STEP)}
            className={`grid min-h-9 min-w-9 place-items-center rounded-lg text-base text-fg hover:bg-surface-sunken disabled:opacity-40 ${focusRing}`}
          >
            −
          </button>
          <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums text-fg-muted">
            <span className="sr-only">Zoom: </span>
            {Math.round(zoom * 100)} %
          </span>
          <button
            type="button"
            aria-label="Acercar"
            title="Acercar (+)"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomTo(z => z * STEP)}
            className={`grid min-h-9 min-w-9 place-items-center rounded-lg text-base text-fg hover:bg-surface-sunken disabled:opacity-40 ${focusRing}`}
          >
            +
          </button>
          <button
            type="button"
            title="Ajustar a la vista (0)"
            onClick={() => {
              if (!fit()) zoomTo(1);
            }}
            className={`min-h-9 rounded-lg px-2.5 text-xs font-medium text-fg hover:bg-surface-sunken ${focusRing}`}
          >
            Ajustar a la vista
          </button>
        </div>
      </div>
      {flowTier.size > 0 && (
        <div
          aria-label="Leyenda del contexto"
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-context-border/50 bg-context-soft px-4 py-2 text-[11px] text-fg-muted"
        >
          <span className="font-medium text-context">
            Contexto que recibió la última ejecución de {selectedNode?.key}
            {flow && flow.conventions.length ? ` · ${flow.conventions.length} convenciones` : ''}:
          </span>
          {[...new Set(flowTier.values())].sort().map(tier => (
            <span key={tier} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: tierColor(tier) }} />
              Nivel {tierLook(tier)}
            </span>
          ))}
        </div>
      )}
      <div
        aria-label="Leyenda del grafo"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-2.5 text-[11px] text-fg-muted"
      >
        {(
          ['PROJECT_ROOT', 'MODULE', 'FEATURE', 'WORK_ITEM', 'REQUIREMENT', 'DECISION_RECORD'] as KnowledgeEntityType[]
        ).map(type => (
          <span key={type} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: stroke(type) }} />
            {ENTITY_LABEL[type]}
          </span>
        ))}
        <span className="ml-auto hidden text-fg-subtle xl:inline">
          Ctrl + rueda: zoom · arrastra el fondo para moverte
        </span>
      </div>
    </section>
  );
}
function FilterGroup<T extends string>({
  title,
  items,
  selected,
  label,
  onToggle,
}: {
  title: string;
  items: T[];
  selected: Set<T>;
  label: (item: T) => string;
  onToggle(item: T): void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <button
            type="button"
            key={item}
            aria-pressed={selected.has(item)}
            onClick={() => onToggle(item)}
            className={`min-h-9 rounded-full border px-3 text-xs transition ${focusRing} ${selected.has(item) ? 'border-accent/60 bg-accent-soft text-fg' : 'border-border text-fg-subtle line-through decoration-fg-subtle/60 hover:text-fg-muted'}`}
          >
            {label(item)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
