import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTheme, type ThemePreference } from '../../state/theme.js';

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);
const options: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: 'system',
    label: 'Sistema',
    icon: icon(
      <>
        <rect x="2" y="3" width="12" height="8" rx="1.5" />
        <path d="M6 14h4M8 11v3" />
      </>,
    ),
  },
  {
    value: 'light',
    label: 'Claro',
    icon: icon(
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </>,
    ),
  },
  { value: 'dark', label: 'Oscuro', icon: icon(<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />) },
];

/** Selector de tema (Sistema / Claro / Oscuro) como grupo de radio con navegación por flechas. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    setPreference(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5"
    >
      {options.map((option, index) => {
        const checked = preference === option.value;
        return (
          <button
            key={option.value}
            ref={element => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={compact ? option.label : undefined}
            title={option.label}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPreference(option.value)}
            onKeyDown={event => move(event, index)}
            className={`inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
          >
            {option.icon}
            {!compact && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
