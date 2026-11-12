import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';

/**
 * Unsaved drafts per view (B4 of the UX audit). Views register what they would lose; the shell asks before switching
 * view or project. Without a provider (isolated component tests) registering does nothing.
 */
interface UnsavedChanges {
  set(id: string, label: string | null): void;
  pending(): string[];
}
const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, string>());
  const value = useMemo<UnsavedChanges>(
    () => ({
      set: (id, label) => (label ? drafts.current.set(id, label) : drafts.current.delete(id)),
      pending: () => [...new Set(drafts.current.values())],
    }),
    [],
  );
  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

/** Marks `label` (e.g. «la política de ejecución») as unsaved while `dirty` is true. */
export function useUnsavedChanges(label: string, dirty: boolean): void {
  const registry = useContext(UnsavedChangesContext),
    id = useId();
  useEffect(() => {
    registry?.set(id, dirty ? label : null);
    return () => registry?.set(id, null);
  }, [registry, id, label, dirty]);
}

/** Returns a check to run before leaving: true when nothing is unsaved or the user agrees to discard it. */
export function useConfirmDiscard(): () => boolean {
  const registry = useContext(UnsavedChangesContext);
  return useCallback(() => {
    const pending = registry?.pending() ?? [];
    if (!pending.length) return true;
    return window.confirm(`Tienes cambios sin guardar en ${listOf(pending)}. ¿Salir y descartarlos?`);
  }, [registry]);
}

const listOf = (items: string[]) =>
  items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
