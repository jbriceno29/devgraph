import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
export interface PositionedGraphNode {
  node: GraphNodeView;
  x: number;
  y: number;
}
export function layoutGraph(nodes: GraphNodeView[], horizontalGap = 240, verticalGap = 150): PositionedGraphNode[] {
  const ids = new Set(nodes.map(node => node.id));
  const children = new Map<string, GraphNodeView[]>();
  const roots: GraphNodeView[] = [];
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId))
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
    else roots.push(node);
  }
  for (const list of children.values()) list.sort((a, b) => a.key.localeCompare(b.key));
  roots.sort((a, b) => a.key.localeCompare(b.key));
  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  const place = (node: GraphNodeView, depth: number): number => {
    const descendants = children.get(node.id) ?? [];
    let x: number;
    if (descendants.length) {
      const xs = descendants.map(child => place(child, depth + 1));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    } else {
      x = cursor * horizontalGap;
      cursor++;
    }
    positions.set(node.id, { x, y: depth * verticalGap });
    return x;
  };
  roots.forEach(root => {
    place(root, 0);
    cursor += 0.75;
  });
  // Keep disconnected or cyclicly-parented data visible after the rooted forest.
  for (const node of nodes)
    if (!positions.has(node.id)) {
      const x = cursor * horizontalGap;
      positions.set(node.id, { x, y: 0 });
      cursor++;
    }
  const all = [...positions.values()];
  const centerX = (Math.min(...all.map(p => p.x)) + Math.max(...all.map(p => p.x))) / 2;
  return nodes.map(node => {
    const point = positions.get(node.id)!;
    return { node, x: point.x - centerX, y: point.y };
  });
}
