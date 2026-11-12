import { useState } from 'react';
import { errorText } from '../errors.js';
import { secondary } from '../ui.js';
import { proposeAccessFromRepository } from './policy.api.js';

/**
 * Plan REP, R1: fills the writable paths and the checks with what the repository has (its folders, root configuration
 * and scripts). It only changes the form: the user reviews it and saves.
 */
export function ProposeAccessButton({
  projectId,
  onProposal,
}: {
  projectId: string;
  onProposal(values: { writablePaths: string; allowedCommands?: string }): void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const propose = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const proposal = await proposeAccessFromRepository(projectId);
      onProposal({
        writablePaths: proposal.writable.map(path => path.pattern).join('\n'),
        ...(proposal.verificationCommands.length ? { allowedCommands: proposal.verificationCommands.join('\n') } : {}),
      });
      setMessage({
        tone: 'ok',
        text: proposal.verificationCommands.length
          ? 'Rutas y comprobaciones propuestas desde el repositorio. Revísalas y guarda la política.'
          : 'Rutas propuestas desde el repositorio (no define scripts de pruebas). Revísalas y guarda la política.',
      });
    } catch (reason) {
      setMessage({ tone: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => void propose()}
        disabled={busy}
        className={`min-h-9 w-full text-xs ${secondary}`}
      >
        {busy ? 'Leyendo el repositorio…' : 'Proponer rutas desde el repositorio'}
      </button>
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-1 text-xs ${message.tone === 'error' ? 'text-danger' : 'text-fg-muted'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
