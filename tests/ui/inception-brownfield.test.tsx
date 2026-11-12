// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InceptionAssistant } from '@desktop/presentation/inception/InceptionAssistant.js';
import type { GraphNodeView } from '../../src/shared/contracts/graph-view.js';
import type { InceptionRepositoryDto, RepositoryScanSummaryDto } from '../../src/shared/contracts/repository-scan.js';
import { installShellIpc } from './shell-ipc.js';
import { fakeInception, proposal, questions } from './inception-fake.js';

const root: GraphNodeView = { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT', label: 'Example Workspace', status: 'ACTIVE' };
const scan: RepositoryScanSummaryDto = {
  repositoryName: 'tienda', totalFiles: 42, truncated: false, hasCode: true, languages: [{ language: 'TypeScript', files: 30 }, { language: 'CSS', files: 4 }], topLevel: ['package.json', 'src/'],
  directories: [{ path: 'src', files: 40 }], excluded: { ignored: 3, generated: 0, symlinks: 1, secrets: 2 }, warnings: [], scannedAt: 'now', bytes: 9000,
  files: [{ path: 'package.json', kind: 'MANIFEST', bytes: 900, truncated: false }, { path: 'src/styles/tokens.css', kind: 'STYLE', bytes: 300, truncated: false }],
};
const repository: InceptionRepositoryDto = { scan, corrections: [], inferences: [
  { id: 'inf-1', area: 'STACK', statement: 'React 18 con Vite.', evidence: ['package.json'] },
  { id: 'inf-2', area: 'DESIGN_SYSTEM', statement: 'Tokens propios con verde #0f766e.', evidence: ['src/styles/tokens.css'] },
] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(initial: Parameters<typeof fakeInception>[0]) {
  const ipc = installShellIpc([root]);
  const fake = fakeInception(initial);
  ipc.inception = fake.client;
  render(<InceptionAssistant projectId="p" nodes={[root]} onNavigate={vi.fn()} />);
  return fake;
}

describe('Asistente de inicio en un repositorio con código (V4)', () => {
  it('before starting, shows what will be read from the repository on request', async () => {
    const { client } = setup({ repositoryPath: '/home/ana/tienda' });
    client.scanRepository = vi.fn(async () => scan);
    expect(await screen.findByText(/leerá sus manifiestos, su estructura de carpetas y sus estilos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver qué se leerá' }));
    await waitFor(() => expect(client.scanRepository).toHaveBeenCalledWith('p'));
    expect(await screen.findByText(/Se leyeron 2 archivos/)).toBeTruthy();
    expect(screen.getByText(/2 posibles secretos \(no se abrieron\)/)).toBeTruthy();
    expect(screen.getByText(/1 enlace simbólico \(no se siguen\)/)).toBeTruthy();
    expect(screen.getByText('src/styles/tokens.css')).toBeTruthy();
  });

  it('shows each inference with its evidence and sends the corrections with the answers', async () => {
    const { client } = setup({ stage: 'ASK_GOALS', status: 'WAITING_USER', nextAction: 'ANSWER', brief: 'Un carrito', questions, repositoryPath: '/home/ana/tienda', repository });
    const findings = await screen.findByText('Lo que se detectó en tu repositorio (2)');
    const panel = findings.closest('details')!;
    expect(panel.open).toBe(true);
    const list = within(panel).getByRole('list', { name: 'Inferencias del repositorio' });
    expect(within(list).getByText('React 18 con Vite.')).toBeTruthy();
    expect(within(list).getByText('Sistema de diseño')).toBeTruthy();
    expect(within(list).getByText('src/styles/tokens.css')).toBeTruthy();
    const [first] = within(list).getAllByLabelText('¿No es así? Corrígelo (opcional)');
    fireEvent.change(first!, { target: { value: 'Es Vue 3, no React' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith('p', [{ questionId: 'q1', answer: '' }, { questionId: 'q2', answer: '' }, { questionId: 'q3', answer: '' }], undefined, { corrections: [{ inferenceId: 'inf-1', correction: 'Es Vue 3, no React' }] }));
  });

  it('the proposal shows what was detected and the user corrected, without fields', async () => {
    setup({ stage: 'PROPOSAL', status: 'WAITING_USER', nextAction: 'APPROVE', brief: 'Un carrito', questions, proposal, repositoryPath: '/home/ana/tienda', repository: { ...repository, corrections: [{ inferenceId: 'inf-1', correction: 'Es Vue 3' }] } });
    const findings = await screen.findByText('Lo que se detectó en tu repositorio (2)');
    const panel = findings.closest('details')!;
    expect(within(panel).getByText('Tu corrección: Es Vue 3')).toBeTruthy();
    expect(within(panel).queryByLabelText('¿No es así? Corrígelo (opcional)')).toBeNull();
  });
});
