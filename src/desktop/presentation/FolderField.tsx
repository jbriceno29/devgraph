import { useState, type ReactNode } from 'react';
import { control, focusRing, secondary } from './ui.js';

/** True when the desktop shell can open the system's folder picker (not in tests or a plain browser). */
export const canPickFolder = () => typeof window !== 'undefined' && Boolean(window.workspaceIpc?.platform?.pickFolder);

/**
 * An absolute folder path: typed, or chosen with the system's picker («Elegir…») when the shell has one.
 * The text stays editable either way, so the field also works where there is no picker.
 */
export function FolderField({
  id,
  label,
  value,
  onChange,
  pickerTitle,
  defaultPath,
  help,
  error,
  disabled = false,
  placeholder = '/home/ana/proyectos',
}: {
  id: string;
  label: string;
  value: string;
  onChange(path: string): void;
  pickerTitle: string;
  /** Where the picker opens (the current value when it has one). */
  defaultPath?: string | null;
  help?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [picking, setPicking] = useState(false),
    [pickError, setPickError] = useState<string | null>(null);
  const pick = async () => {
    const pickFolder = window.workspaceIpc?.platform?.pickFolder;
    if (!pickFolder) return;
    setPicking(true);
    setPickError(null);
    try {
      const start = value.trim() || defaultPath || undefined;
      const chosen = await pickFolder({ title: pickerTitle, ...(start ? { defaultPath: start } : {}) });
      if (chosen) onChange(chosen);
    } catch (reason) {
      setPickError(
        `No se pudo abrir el selector de carpetas (${reason instanceof Error ? reason.message : String(reason)}). Escribe la ruta.`,
      );
    } finally {
      setPicking(false);
    }
  };
  const message = error ?? pickError;
  const described = [help ? `${id}-help` : '', message ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs text-fg-muted">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          disabled={disabled}
          onChange={event => {
            onChange(event.target.value);
            setPickError(null);
          }}
          aria-invalid={message ? true : undefined}
          aria-describedby={described || undefined}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={`${control} min-h-10 min-w-0 flex-1 font-mono ${message ? 'border-danger' : ''}`}
        />
        {canPickFolder() && (
          <button
            type="button"
            onClick={() => void pick()}
            disabled={disabled || picking}
            className={`min-h-10 shrink-0 text-xs ${secondary} ${focusRing}`}
          >
            {picking ? 'Eligiendo…' : 'Elegir…'}
          </button>
        )}
      </div>
      {help && (
        <div id={`${id}-help`} className="mt-1.5 text-[11px] leading-4 text-fg-muted">
          {help}
        </div>
      )}
      {message && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

/** `folder` + `name` with the folder's own separator (a Windows path keeps backslashes). */
export function joinFolder(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** Last segment of a path (to name a project after the folder of its code). */
export const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';
