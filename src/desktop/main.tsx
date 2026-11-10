import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceNavigationProvider } from './state/workspace-navigation-context.js';
import { workspaceIpc } from './platform/tauri-ipc-client.js';
import { WorkspaceShell } from './state/WorkspaceShell.js';
import './styles.css';
window.workspaceIpc=workspaceIpc;
createRoot(document.getElementById('root')!).render(<StrictMode><WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider></StrictMode>);
