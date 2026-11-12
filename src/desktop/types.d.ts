import type { WorkspaceIpcClient } from '../shared/contracts/ipc-contracts.js';
declare global {
  interface Window {
    workspaceIpc: WorkspaceIpcClient;
  }
}
export {};
