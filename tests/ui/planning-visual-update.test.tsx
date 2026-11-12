// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { installShellIpc } from './shell-ipc.js';
import { openShell, selectView } from './helpers.js';
import type { ChangeSetDto } from '../../src/shared/contracts/ipc-contracts.js';
import type { InceptionReferenceDto } from '../../src/shared/contracts/inception-view.js';

afterEach(cleanup);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const nodes = [{ id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Example Workspace', status: 'ACTIVE' }, { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Catálogo', status: 'DRAFT', parentId: 'root' }];
const proposal: ChangeSetDto = { id: 'cs-9', projectId: 'p', baseGraphRevision: 1, originType: 'AI_CHAT', title: 'Carrito', rationale: 'Nueva feature.', status: 'VALIDATED', operations: [{ type: 'CREATE_FEATURE', tempId: '$cart', moduleId: 'm', title: 'Carrito' }], validationIssues: [], createdAt: 'now' };
const understood = (status: InceptionReferenceDto['status']): InceptionReferenceDto => ({ id: 'ref-1', name: 'carrito.png', kind: 'VISUAL', note: 'el verde', mimeType: 'image/png', bytes: PNG.length, status, error: status === 'FAILED' ? 'Imagen ilegible.' : null, translation: status === 'TRANSLATED' ? { summary: 'Panel lateral verde.', palette: ['Verde #0f766e'], typography: '', layout: 'Panel lateral', screens: [], actions: [], flows: [], states: [], ideas: [], openQuestions: [] } : null });

async function open(uiSpec: boolean) {
  const client = installShellIpc(nodes);
  client.queries.listArtifacts = vi.fn(async () => (uiSpec ? [{ id: 'spec-1', projectId: 'p', displayKey: 'DOC-001', title: 'UI', summary: '', entityType: 'ARTIFACT' as const, artifactType: 'SPEC', version: 1, adrNumber: null, relativePath: 'docs/UI_SPEC.md', contentHash: 'h', syncStatus: 'SYNCED' as const }] : []));
  client.commands.proposeChanges = vi.fn(async () => proposal);
  client.queries.listChangeSets = vi.fn(async () => []);
  await openShell(); await selectView(/Planificar/);
  return client;
}
const attach = async () => { const input = await screen.findByLabelText('Adjuntar archivos'); await act(async () => { fireEvent.change(input, { target: { files: [new File([PNG], 'carrito.png', { type: 'image/png' })] } }); }); };

it('translates the attached references first, shows what was understood and proposes with them and the UI_SPEC update', async () => {
  const client = await open(true);
  client.commands.translateReferences = vi.fn(async () => [understood('TRANSLATED')]);
  fireEvent.change(await screen.findByLabelText('¿Qué quieres cambiar?'), { target: { value: 'Añade un carrito' } });
  await attach();
  fireEvent.change(screen.getByLabelText('Qué conservar o evitar (opcional)'), { target: { value: 'el verde' } });
  const checkbox = await screen.findByRole('checkbox', { name: /Actualizar docs\/UI_SPEC\.md con este cambio/ });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Proponer cambios' }));
  await waitFor(() => expect(client.commands.translateReferences).toHaveBeenCalledWith('p', [{ name: 'carrito.png', kind: 'VISUAL', note: 'el verde', dataBase64: expect.any(String) }]));
  await waitFor(() => expect(client.commands.proposeChanges).toHaveBeenCalledWith('p', 'Añade un carrito', 'root', undefined, undefined, { references: [{ name: 'carrito.png', kind: 'VISUAL', note: 'el verde', translation: understood('TRANSLATED').translation }], updateUiSpec: true }));
  expect(await screen.findByText('Cómo se entendieron tus referencias (1)')).toBeTruthy();
  expect(screen.getByText('Panel lateral verde.')).toBeTruthy();
  // After proposing, the form is clear again.
  await waitFor(() => expect((screen.getByRole('checkbox', { name: /Actualizar docs\/UI_SPEC\.md/ }) as HTMLInputElement).checked).toBe(false));
});

it('a reference that cannot be read stops before proposing, and a project without UI_SPEC offers to create it', async () => {
  const client = await open(false);
  client.commands.translateReferences = vi.fn(async () => [understood('FAILED')]);
  expect(await screen.findByRole('checkbox', { name: /Crear docs\/UI_SPEC\.md con este cambio/ })).toBeTruthy();
  fireEvent.change(await screen.findByLabelText('¿Qué quieres cambiar?'), { target: { value: 'Añade un carrito' } });
  await attach();
  fireEvent.click(screen.getByRole('button', { name: 'Proponer cambios' }));
  expect(await screen.findByText(/No se pudo analizar «carrito\.png»: Imagen ilegible\./)).toBeTruthy();
  expect(client.commands.proposeChanges).not.toHaveBeenCalled();
});
