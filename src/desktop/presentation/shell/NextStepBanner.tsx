import type { NextStep, ShellTarget } from './next-step.js';

const tones = {
  neutral: 'border-accent/40 bg-accent-soft',
  attention: 'border-warning/50 bg-warning-soft',
  success: 'border-success/50 bg-success-soft',
};
const eyebrow = { neutral: 'text-accent', attention: 'text-warning', success: 'text-success' };

/** Recomendación única con su botón primario («siguiente paso»). */
export function NextStepBanner({ step, onGo }: { step: NextStep; onGo(target: ShellTarget): void }) {
  return (
    <section
      aria-labelledby="next-step-title"
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border px-4 py-3 ${tones[step.tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${eyebrow[step.tone]}`}>Siguiente paso</p>
        <h2 id="next-step-title" className="mt-0.5 text-sm font-semibold text-fg">
          {step.title}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">{step.detail}</p>
      </div>
      <button
        type="button"
        onClick={() => onGo(step.target)}
        className="min-h-9 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {step.actionLabel}
      </button>
    </section>
  );
}
