import { describe, expect, it } from 'vitest';
import { operationLabel } from '../../src/desktop/presentation/labels.js';

describe('operationLabel', () => {
  it('names every ChangeSet operation in plain Spanish (none falls back to the raw type)', () => {
    expect(
      [
        'CREATE_MODULE',
        'CREATE_FEATURE',
        'CREATE_REQUIREMENT',
        'CREATE_WORK_ITEM',
        'CREATE_DECISION_RECORD',
        'UPSERT_ARTIFACT',
        'CREATE_RELATIONSHIP',
        'DELETE_RELATIONSHIP',
        'UPDATE_ENTITY_STATUS',
        'SET_PROJECT_PROFILE',
      ].map(operationLabel),
    ).toEqual([
      'Crear módulo',
      'Crear feature',
      'Crear requisito',
      'Crear tarea',
      'Registrar decisión',
      'Crear o actualizar documento',
      'Relacionar',
      'Quitar relación',
      'Cambiar estado',
      'Definir el perfil del proyecto',
    ]);
  });
});
