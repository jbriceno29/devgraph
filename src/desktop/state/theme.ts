import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'graphworkspace.theme';
const QUERY = '(prefers-color-scheme: dark)';
const isPreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

/** Lee la preferencia guardada; si el almacenamiento falla o no existe, es 'system'. */
export function readThemePreference(): ThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
const media = () => {
  try {
    return typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
};
const systemTheme = (): ResolvedTheme => (media()?.matches ? 'dark' : 'light');
/** Pone data-theme en <html> solo si la preferencia es explícita; en 'system' manda la media query del CSS. */
export function applyThemePreference(preference: ThemePreference) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

// Almacén mínimo compartido: todos los useTheme() ven la misma preferencia.
let current: ThemePreference | undefined;
const listeners = new Set<() => void>();
const getPreference = () => (current ??= readThemePreference());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function setThemePreference(preference: ThemePreference) {
  current = preference;
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* sin persistencia: la UI sigue funcionando */
  }
  applyThemePreference(preference);
  listeners.forEach(listener => listener());
}
/** Solo para pruebas: olvida la preferencia en memoria para releerla del almacenamiento. */
export function resetThemeStateForTests() {
  current = undefined;
}

const noopSubscribe = () => () => undefined;
const subscribeSystem = (listener: () => void) => {
  const query = media();
  if (!query) return () => undefined;
  if (query.addEventListener) {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
};

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
} {
  const preference = useSyncExternalStore(subscribe, getPreference, getPreference);
  // Solo escucha al sistema mientras la preferencia es 'system'; el efecto limpia el listener al cambiar.
  const system = useSyncExternalStore(
    preference === 'system' ? subscribeSystem : noopSubscribe,
    systemTheme,
    () => 'dark' as ResolvedTheme,
  );
  useEffect(() => {
    applyThemePreference(preference);
  }, [preference]);
  const setPreference = useCallback((next: ThemePreference) => {
    if (isPreference(next)) setThemePreference(next);
  }, []);
  return { preference, resolved: preference === 'system' ? system : preference, setPreference };
}
