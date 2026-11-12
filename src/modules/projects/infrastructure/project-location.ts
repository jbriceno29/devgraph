import type { CreateProjectInput } from '../../../shared/contracts/ipc-contracts.js';
import { inspectFolder } from './project-folders.js';

/** A project's folder: a new one must be missing or empty (inside an existing folder); an existing one must hold `.git`. */
export async function checkProjectLocation(location: NonNullable<CreateProjectInput['location']>): Promise<void> {
  if (location.mode !== 'NEW_FOLDER' && location.mode !== 'EXISTING_REPOSITORY')
    throw new Error('Indica si el proyecto va en una carpeta nueva o en un repositorio que ya existe.');
  const folder = await inspectFolder(location.path);
  if (location.mode === 'EXISTING_REPOSITORY') {
    if (!folder.isDirectory) throw new Error(`No existe la carpeta «${folder.path}».`);
    if (!folder.isGitRepository)
      throw new Error(`«${folder.path}» no es un repositorio Git (no tiene «.git»). Elige la carpeta que lo contiene.`);
    return;
  }
  if (!folder.parentExists) throw new Error(`La carpeta que la contendría no existe: «${folder.path}».`);
  if (folder.exists && !folder.isDirectory) throw new Error(`«${folder.path}» ya existe y no es una carpeta.`);
  if (folder.exists && !folder.empty)
    throw new Error(
      folder.isGitRepository
        ? `Ya hay un repositorio en «${folder.path}». Si es el código de este proyecto, elige «Ya tengo el código».`
        : `La carpeta «${folder.path}» ya existe y tiene archivos. Usa otro nombre.`,
    );
}
