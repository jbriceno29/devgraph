import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InceptionReferenceFilesPort } from '../../application/ports/inception-port.js';

const FILE_NAME = /^(?:ref|design)-\d{1,2}\.[a-z0-9]{2,5}$/;

/**
 * The attached files of a project inception, under `<projects>/<projectId>/inception/references/` (or, for references attached while planning a feature,
 * `<projects>/<projectId>/planning/references/`, kept only during the translation). File names are fixed by the app (`ref-<n>.<ext>` for references,
 * `design-<n>.<ext>` for imported design images), never by the user.
 */
export class InceptionReferenceFiles implements InceptionReferenceFilesPort {
  constructor(
    private readonly projectsRoot: string,
    private readonly area: 'inception' | 'planning' = 'inception',
  ) {}
  private folder(projectId: string): string {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(projectId)) throw new Error('Proyecto inválido.');
    return join(this.projectsRoot, projectId, this.area, 'references');
  }
  pathOf(projectId: string, file: string): string {
    if (!FILE_NAME.test(file)) throw new Error(`Nombre de referencia no válido: ${file}`);
    return join(this.folder(projectId), file);
  }
  read(projectId: string, file: string): Buffer {
    return readFileSync(this.pathOf(projectId, file));
  }
  save(projectId: string, file: string, content: Buffer): void {
    const target = this.pathOf(projectId, file);
    mkdirSync(this.folder(projectId), { recursive: true });
    writeFileSync(target, content);
  }
  deleteAll(projectId: string): void {
    rmSync(this.folder(projectId), { recursive: true, force: true });
  }
}
