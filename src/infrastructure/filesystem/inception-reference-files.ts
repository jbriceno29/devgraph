import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InceptionReferenceFilesPort } from '../../application/ports/inception-port.js';

const FILE_NAME = /^ref-\d{1,2}\.[a-z0-9]{2,5}$/;

/** The attached files of a project inception, under `<projects>/<projectId>/inception/references/`. File names are fixed by the app (`ref-<n>.<ext>`), never by the user. */
export class InceptionReferenceFiles implements InceptionReferenceFilesPort {
  constructor(private readonly projectsRoot: string) {}
  private folder(projectId: string): string { return join(this.projectsRoot, projectId, 'inception', 'references'); }
  pathOf(projectId: string, file: string): string {
    if (!FILE_NAME.test(file)) throw new Error(`Nombre de referencia no válido: ${file}`);
    return join(this.folder(projectId), file);
  }
  save(projectId: string, file: string, content: Buffer): void {
    const target = this.pathOf(projectId, file);
    mkdirSync(this.folder(projectId), { recursive: true });
    writeFileSync(target, content);
  }
  deleteAll(projectId: string): void { rmSync(this.folder(projectId), { recursive: true, force: true }); }
}
