import { useEffect, useState } from 'react';
import type { ExecutionPolicyDto } from '../../../shared/contracts/agent-view.js';
import { errorText } from '../errors.js';
import { control, primary } from '../ui.js';

type Field = 'writablePaths' | 'readonlyPaths' | 'deniedPaths' | 'allowedCommands';
const fields: Array<{ key: Field; label: string; hint: string }> = [
  { key: 'writablePaths', label: 'Rutas escribibles', hint: 'Una por línea, p. ej. src/**' },
  { key: 'readonlyPaths', label: 'Rutas de solo lectura', hint: 'El agente puede leerlas, no cambiarlas.' },
  { key: 'deniedPaths', label: 'Rutas prohibidas', hint: 'Ni lectura ni escritura, p. ej. .env*' },
  {
    key: 'allowedCommands',
    label: 'Comandos de verificación',
    hint: 'Uno por línea, sin tuberías, p. ej. npm test. Se ejecutan al validar.',
  },
];

type DecisionPolicyDto = NonNullable<ExecutionPolicyDto['decisionPolicy']>;
type DecisionCategory = keyof DecisionPolicyDto['rules'];
// Mirrors DECISION_CATEGORIES / DEFAULT_DECISION_POLICY in src/domain/autonomy/decision-policy.ts (the UI does not import the domain).
const decisionCategories: Array<{ category: DecisionCategory; label: string }> = [
  { category: 'NEW_TASK', label: 'Agregar tareas dentro de la misma feature' },
  { category: 'TASK_DEPENDENCY', label: 'Agregar dependencias entre tareas de la feature' },
  { category: 'TASK_STATUS', label: 'Cambiar el estado de tareas de la feature (por ejemplo, archivar una que sobra)' },
  { category: 'DECISION_RECORD', label: 'Registrar decisiones de arquitectura (ADR)' },
  {
    category: 'SCOPE_CHANGE',
    label: 'Cambiar el alcance: features, módulos, requisitos, documentos o entidades de otras features',
  },
];
const defaultDecisionPolicy: DecisionPolicyDto = {
  rules: { NEW_TASK: 'AUTO', TASK_DEPENDENCY: 'AUTO', TASK_STATUS: 'ASK', DECISION_RECORD: 'ASK', SCOPE_CHANGE: 'ASK' },
  maxAutoTasksPerFeature: 5,
};

/** Edits the project's execution policy: what the agent may write and which checks validate its work. */
export function ExecutionPolicyForm({ projectId }: { projectId: string }) {
  const [values, setValues] = useState<Record<Field, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [turns, setTurns] = useState('0');
  const [rules, setRules] = useState<DecisionPolicyDto['rules']>(defaultDecisionPolicy.rules);
  const [maxAutoTasks, setMaxAutoTasks] = useState(String(defaultDecisionPolicy.maxAutoTasksPerFeature));
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    void window.workspaceIpc.queries
      .getExecutionPolicy(projectId)
      .then(policy => {
        if (current) {
          setValues(toText(policy));
          setMinutes(String(policy.maxExecutionMinutes ?? 30));
          setTurns(String(policy.maxTurns ?? 0));
          loadDecisions(policy);
        }
      })
      .catch(reason => {
        if (current) setMessage({ tone: 'error', text: errorText(reason) });
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  const loadDecisions = (policy: ExecutionPolicyDto) => {
    const decisions = policy.decisionPolicy ?? defaultDecisionPolicy;
    setRules({ ...defaultDecisionPolicy.rules, ...decisions.rules });
    setMaxAutoTasks(String(decisions.maxAutoTasksPerFeature));
  };

  const save = async () => {
    if (!values) return;
    const max = Number(maxAutoTasks);
    if (maxAutoTasks.trim() === '' || !Number.isInteger(max) || max < 0 || max > 50) {
      setMessage({
        tone: 'error',
        text: 'El máximo de tareas automáticas por feature debe ser un número entero entre 0 y 50.',
      });
      return;
    }
    const maxTurns = Number(turns.trim() || '0');
    if (!Number.isInteger(maxTurns) || maxTurns < 0 || maxTurns > 1000) {
      setMessage({
        tone: 'error',
        text: 'El tope de turnos por ejecución debe ser un número entero entre 0 (sin límite) y 1000.',
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await window.workspaceIpc.commands.updateExecutionPolicy(projectId, {
        writablePaths: lines(values.writablePaths),
        readonlyPaths: lines(values.readonlyPaths),
        deniedPaths: lines(values.deniedPaths),
        allowedCommands: lines(values.allowedCommands),
        maxExecutionMinutes: Number(minutes),
        maxTurns,
        decisionPolicy: { rules, maxAutoTasksPerFeature: max },
      });
      setValues(toText(saved));
      setTurns(String(saved.maxTurns ?? 0));
      loadDecisions(saved);
      setMessage({
        tone: 'ok',
        text: saved.allowedCommands.length
          ? 'Política guardada.'
          : 'Política guardada. Sin comandos de verificación, las ejecuciones no se prueban automáticamente.',
      });
    } catch (reason) {
      setMessage({ tone: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="policy-heading" className="rounded-xl border border-border">
      <div className="border-b border-border px-4 py-3">
        <h3 id="policy-heading" className="text-xs font-semibold text-fg">
          Política de ejecución
        </h3>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Qué puede tocar el agente y cómo se verifica su trabajo. Se aplica dentro del motor y se vuelve a auditar al
          terminar.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {!values
          ? message?.tone !== 'error' && <p className="text-xs text-fg-muted">Cargando…</p>
          : fields.map(field => (
              <div key={field.key}>
                <label htmlFor={`policy-${field.key}`} className="mb-1 block text-xs text-fg-muted">
                  {field.label}
                </label>
                <textarea
                  id={`policy-${field.key}`}
                  aria-describedby={`policy-${field.key}-hint`}
                  value={values[field.key]}
                  onChange={event => setValues({ ...values, [field.key]: event.target.value })}
                  rows={field.key === 'writablePaths' ? 4 : 2}
                  spellCheck={false}
                  className={`${control} resize-y py-2 font-mono`}
                />
                <p id={`policy-${field.key}-hint`} className="mt-0.5 text-[11px] text-fg-subtle">
                  {field.hint}
                </p>
              </div>
            ))}
        {values && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="policy-max-minutes" className="mb-1 block text-xs text-fg-muted">
                Tiempo máximo por ejecución (minutos)
              </label>
              <input
                id="policy-max-minutes"
                type="number"
                min={1}
                max={240}
                value={minutes}
                onChange={event => setMinutes(event.target.value)}
                className={`${control} max-w-28`}
              />
            </div>
            <div>
              <label htmlFor="policy-max-turns" className="mb-1 block text-xs text-fg-muted">
                Tope de turnos por ejecución
              </label>
              <input
                id="policy-max-turns"
                aria-describedby="policy-max-turns-hint"
                type="number"
                min={0}
                max={1000}
                step={1}
                value={turns}
                onChange={event => setTurns(event.target.value)}
                className={`${control} max-w-28`}
              />
            </div>
            <p id="policy-max-turns-hint" className="text-[11px] text-fg-subtle sm:col-span-2">
              Turnos: limita la exploración del agente (lecturas, búsquedas, comandos). 0 = sin límite. Al alcanzarlo la
              ejecución falla y el piloto reintenta con ese motivo.
            </p>
          </div>
        )}
        {values && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-fg">Decisiones del agente</legend>
            <p className="text-[11px] text-fg-muted">
              Al cerrar una tarea el agente puede proponer cambios al plan. Elige cuáles se aplican solos y cuáles te
              pregunta.
            </p>
            {decisionCategories.map(item => (
              <div key={item.category} className="flex items-center justify-between gap-3">
                <label htmlFor={`decision-${item.category}`} className="text-xs text-fg-muted">
                  {item.label}
                </label>
                <select
                  id={`decision-${item.category}`}
                  value={rules[item.category]}
                  onChange={event => setRules({ ...rules, [item.category]: event.target.value as 'AUTO' | 'ASK' })}
                  className={`${control} w-auto shrink-0`}
                >
                  <option value="AUTO">Automático</option>
                  <option value="ASK">Preguntar</option>
                </select>
              </div>
            ))}
            <div>
              <label htmlFor="decision-max-auto-tasks" className="mb-1 block text-xs text-fg-muted">
                Máximo de tareas automáticas por feature
              </label>
              <input
                id="decision-max-auto-tasks"
                type="number"
                min={0}
                max={50}
                step={1}
                value={maxAutoTasks}
                onChange={event => setMaxAutoTasks(event.target.value)}
                className={`${control} max-w-28`}
              />
            </div>
          </fieldset>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !values}
          className={`min-h-9 w-full text-xs ${primary}`}
        >
          Guardar política
        </button>
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`text-xs ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

function toText(policy: ExecutionPolicyDto): Record<Field, string> {
  return {
    writablePaths: policy.writablePaths.join('\n'),
    readonlyPaths: policy.readonlyPaths.join('\n'),
    deniedPaths: policy.deniedPaths.join('\n'),
    allowedCommands: policy.allowedCommands.join('\n'),
  };
}
function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}
