import type { RepositoryScanDto } from '../../shared/contracts/repository-scan.js';

/**
 * Reads what a repository with code already says about itself (manifests, structure, styles) without running anything. Implementations must
 * respect `.gitignore`, never follow symbolic links, never open credential-like files, never leave the repository and keep the whole
 * result (serialized) within MAX_SCAN_BYTES.
 */
export interface RepositoryScannerPort {
  scan(repositoryPath: string): Promise<RepositoryScanDto>;
}
