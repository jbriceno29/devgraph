/**
 * Plan S4: which runs receive the skills that ship with the app. Only interface work gets an INTERFACE skill: skills
 * cost tokens on every run that carries them (the lesson of H1), so a task gets one only when it is about the interface.
 */
const INTERFACE_WORDS =
  /\b(?:interfaz|interfaces|pantallas?|vistas?|componentes?|estilos?|css|diseño|maquetaci[oó]n|layout|formularios?|botones|bot[oó]n|men[uú]s?|modal(?:es)?|accesibilidad|responsive|tema|ui|ux|frontend|landing)\b/i;

export interface SkillTaskInput {
  title: string;
  summary: string;
}

/**
 * A run is interface work when the project has an interface and some task of the run is about it: its feature is
 * documented by the approved UI specification, or its title or summary talks about the interface.
 */
export function isInterfaceWork(input: {
  projectHasInterface: boolean;
  documentedByUiSpec: boolean;
  tasks: readonly SkillTaskInput[];
}): boolean {
  if (!input.projectHasInterface && !input.documentedByUiSpec) return false;
  return input.documentedByUiSpec || input.tasks.some(task => INTERFACE_WORDS.test(`${task.title}\n${task.summary}`));
}

/** The project has an interface when its stack says so (the catalog profiles use the key «interfaz»). */
export function stackHasInterface(techStack: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(techStack ?? {}).some(
    ([key, value]) =>
      /^interfaz$|^ui$|^frontend$/i.test(key) &&
      typeof value === 'string' &&
      value.trim() !== '' &&
      !/^(?:ninguna|no|n\/a)$/i.test(value.trim()),
  );
}
