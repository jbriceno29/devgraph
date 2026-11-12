/**
 * Plan S5: signs that a run may have weakened its own verification. The checks the agent passes are mostly tests it
 * wrote, so a run that deletes tests, skips them, or edits the configuration that decides what runs is not accepted on
 * its own: it still completes (nothing is lost), but a person looks at it first. Flags, not failures, so legitimate
 * changes are never blocked.
 */
export interface QualityFlagInput {
  filePath: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  diffPatch: string | null;
}

const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.py$/i;
const SKIP =
  /\b(?:it|test|describe|suite)\.(?:skip|only|todo)\s*\(|\bx(?:it|describe|test)\s*\(|@(?:unittest\.)?skip(?:If|Unless)?\b|\bpytest\.mark\.skip/;
/** Files that decide which checks run and how strictly (at the root or in any folder). */
const VERIFICATION_CONFIG =
  /(?:^|\/)(?:tsconfig(?:\.[\w-]+)?\.json|(?:vite|vitest|jest|playwright)\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|pytest\.ini|conftest\.py|setup\.cfg|tox\.ini|\.eslintrc(?:\.\w+)?|eslint\.config\.[cm]?js)$/i;

export function qualityFlags(files: readonly QualityFlagInput[]): string[] {
  const flags: string[] = [];
  for (const file of files) {
    if (TEST_FILE.test(file.filePath) && file.changeType === 'DELETED') flags.push(`Borra pruebas: ${file.filePath}`);
    else if (TEST_FILE.test(file.filePath) && addedLines(file.diffPatch).some(line => SKIP.test(line)))
      flags.push(`Salta o aísla pruebas (skip/only): ${file.filePath}`);
    // Creating the configuration is the scaffold's job; changing or deleting one that existed needs a look.
    if (VERIFICATION_CONFIG.test(file.filePath) && file.changeType !== 'ADDED')
      flags.push(`Cambia la configuración de verificación: ${file.filePath}`);
  }
  return flags;
}

function addedLines(patch: string | null): string[] {
  return (patch ?? '').split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
}
