// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeMapStatus } from '@desktop/presentation/inception/CodeMapStatus.js';
import { ExistingCode } from '@desktop/presentation/inception/ProposalPlan.js';
import type { RepositorySurveyStateDto } from '../../src/shared/contracts/repository-survey.js';

afterEach(cleanup);

const state = (over: Partial<RepositorySurveyStateDto>): RepositorySurveyStateDto => ({
  status: 'RUNNING',
  survey: null,
  error: null,
  startedAt: 'now',
  finishedAt: null,
  ...over,
});
const capability = (title: string, status: 'COMPLETE' | 'PARTIAL') => ({
  title,
  summary: '',
  status,
  evidence: ['src/a.ts'],
  missing: '',
});

describe('the map of what exists in the inception (plan REP, R3)', () => {
  it('says it reads the code in the background, then what it found, or that the proposal goes without it', () => {
    const { rerender } = render(<CodeMapStatus survey={state({})} />);
    expect(screen.getByRole('status')?.textContent).toMatch(/Leyendo el código.*la propuesta lo esperará/);
    rerender(
      <CodeMapStatus
        survey={state({
          status: 'DONE',
          survey: {
            modules: [
              {
                name: 'Carrito',
                summary: '',
                paths: [],
                capabilities: [capability('A', 'COMPLETE'), capability('B', 'PARTIAL')],
              },
            ],
            entryPoints: [],
            tests: { description: '', evidence: [] },
            pending: [],
            ref: 'main',
            commit: 'abc',
          },
        })}
      />,
    );
    expect(screen.getByRole('status')?.textContent).toContain('Listo: 1 módulo y 2 capacidades (1 a medias)');
    rerender(<CodeMapStatus survey={state({ status: 'FAILED', error: 'Sin conexión.' })} />);
    expect(screen.getByRole('alert')?.textContent).toContain(
      'No se pudo leer el código: Sin conexión. La propuesta se hará sin mapa.',
    );
    rerender(<CodeMapStatus survey={null} />);
    expect(screen.queryByLabelText('Mapa del código')).toBeNull();
  });

  it('the proposal lists what already exists, done or half done, with no raw codes', () => {
    render(
      <ExistingCode
        existing={[
          {
            module: 'Carrito',
            capabilities: [
              { title: 'Añadir', status: 'COMPLETE' },
              { title: 'Descuentos', status: 'PARTIAL' },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('Carrito')).toBeTruthy();
    expect(screen.getByText('Añadir').nextSibling?.textContent).toContain('hecha');
    expect(screen.getByText('Descuentos').nextSibling?.textContent).toContain('a medias');
    expect(document.body.textContent).not.toMatch(/PARTIAL|COMPLETE/);
    expect(document.body.textContent).toContain('docs/MAPA_DEL_CODIGO.md');
  });
});
