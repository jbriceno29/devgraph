import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Lee los tokens de cada tema y comprueba WCAG AA: 4,5:1 para texto, 3:1 para elementos gráficos.
const css = readFileSync(new URL('../../src/desktop/theme/tokens.css', import.meta.url), 'utf8');
/** The declarations of a rule, whatever the formatting: the CSS is normalized (no space before `{`, unquoted attribute values). */
const normalized = css.replace(/\s*\{/g, '{').replace(/="([\w-]+)"/g, '=$1');
const block = (selector: string) => {
  const start = normalized.indexOf(`${selector}{`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = normalized.slice(start + selector.length + 1, normalized.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value!.toLowerCase()]),
  );
};
const themes = { light: block(':root'), dark: block(':root[data-theme=dark]') };
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
};
const ratio = (a: string, b: string) => {
  const [x = 0, y = 0] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const nodeTypes = [
  'project-root',
  'module',
  'feature',
  'requirement',
  'work-item',
  'milestone',
  'decision-record',
  'artifact',
  'code-reference',
];
const statuses = ['ready', 'in-progress', 'in-review', 'done', 'blocked', 'draft', 'archived'];
const surfaces = ['surface', 'surface-raised', 'surface-sunken'];
const pairs: [string, string, number][] = [
  ...['fg', 'fg-muted', 'fg-subtle', 'accent', 'success', 'warning', 'danger', 'info'].flatMap(fg =>
    surfaces.map(bg => [fg, bg, 4.5] as [string, string, number]),
  ),
  ['accent-fg', 'accent', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['fg', 'accent-soft', 4.5],
  ...statuses.flatMap(status =>
    ['surface', 'surface-raised', 'node-work-item-fill'].map(
      bg => [`status-${status}`, bg, 4.5] as [string, string, number],
    ),
  ),
  ...nodeTypes.flatMap(
    type =>
      [
        [`node-${type}-stroke`, `node-${type}-fill`, 4.5],
        ['node-fg', `node-${type}-fill`, 4.5],
      ] as [string, string, number][],
  ),
  ['node-ghost-stroke', 'node-ghost-fill', 4.5],
  ['node-selected', 'surface', 3],
  ['edge-label', 'surface', 4.5],
  ['edge-cross', 'surface', 3],
  ...[1, 2, 3, 4, 5].map(tier => [`tier-${tier}`, 'surface', 3] as [string, string, number]),
  // Piloto automático y flujo de contexto: texto sobre las superficies, su fondo suave y la tarjeta de feature del grafo; borde como elemento gráfico.
  ...['pilot', 'context'].flatMap(name =>
    [...surfaces, `${name}-soft`].map(bg => [name, bg, 4.5] as [string, string, number]),
  ),
  ['pilot', 'node-feature-fill', 4.5],
  ['pilot-border', 'pilot-soft', 1.5],
  ['context-border', 'context-soft', 1.5],
];

describe('tokens de tema', () => {
  it('los dos bloques oscuros (forzado y del sistema) son idénticos', () => {
    const media = normalized.slice(normalized.indexOf('@media (prefers-color-scheme: dark){'));
    expect(block(':root:not([data-theme=light])')).toEqual(themes.dark);
    expect(media).toContain(':root:not([data-theme=light]){');
  });
  it('ambos temas definen los mismos tokens y el oscuro conserva la base actual', () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
    expect(themes.dark.surface).toBe('#090d18');
    expect(themes.dark.accent).toBe('#22d3ee');
  });
  for (const [name, theme] of Object.entries(themes))
    it(`contraste AA en tema ${name}`, () => {
      const failures = pairs.flatMap(([fg, bg, min]) => {
        expect(theme[fg], `${name}: falta --${fg}`).toBeDefined();
        expect(theme[bg], `${name}: falta --${bg}`).toBeDefined();
        const value = ratio(theme[fg]!, theme[bg]!);
        return value + 1e-9 < min ? [`${fg} sobre ${bg}: ${value.toFixed(2)} < ${min}`] : [];
      });
      expect(failures).toEqual([]);
    });
});
