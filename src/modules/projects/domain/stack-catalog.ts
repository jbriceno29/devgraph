import type { ProjectProfile } from '../../knowledge/index.js';

/**
 * Stack profiles the app recommends for a new project (plan S1). The catalog ships with the app and is the authority on
 * stack, structure, rules and verification: the inception assistant only picks a profile and adapts the plan to it, and
 * `applyStackProfile` merges the profile into the proposal deterministically.
 *
 * Packages carry no version on purpose: the version is fixed by the lockfile when the app installs them (plan S2), so the
 * catalog never depends on what a model remembers. `reviewedAt` says when the choices were last checked.
 *
 * Verification calls the installed binaries (`node_modules/.bin/...`), never package scripts, because the agent can edit
 * `package.json` but not what the app installed.
 */
export interface StackProfile {
  id: string;
  title: string;
  /** When to choose it, for the assistant and the user. */
  whenToUse: string;
  techStack: Record<string, string>;
  /** null: no external packages (standard library only). */
  packageManager: 'npm' | null;
  dependencies: readonly string[];
  devDependencies: readonly string[];
  /** Folder layout, one line. */
  structure: string;
  rules: readonly string[];
  verificationCommands: readonly string[];
  /** Files and folders outside the default writable ones (src/, tests/, docs/) the stack needs: configuration at the root. */
  writablePaths: readonly string[];
  /** What the scaffold task must create on top of what the app provides. */
  scaffold: string;
  reviewedAt: string;
}

/** Level-1 rules every project gets, whatever its stack. Short on purpose: they reach every run. */
export const APP_RULES: readonly string[] = [
  'Cada cambio de comportamiento llega con su prueba, y la prueba falla sin el cambio.',
  'Valida la entrada en los bordes (interfaz, API, archivos, argumentos) y trata los errores de forma explícita; nunca los silencies.',
  'Ningún secreto en el código ni en el repositorio: la configuración sensible va en variables de entorno.',
  'Módulos y funciones pequeños con una sola responsabilidad; sin código muerto ni comentado.',
];

const REVIEWED = '2026-11-11';
const NPM_SCAFFOLD =
  'La app crea package.json con las dependencias del perfil y las instala antes de que empieces: no edites "dependencies" ni "devDependencies" ni instales nada. Crea la configuración (tsconfig.json con "strict": true y la del framework de pruebas), la estructura de carpetas del perfil, un README con cómo ejecutar y probar, y una prueba de humo que pase con los comandos de verificación.';
const TS_VERIFY = ['node_modules/.bin/tsc --noEmit', 'node_modules/.bin/vitest run'] as const;
/** Root files every npm profile writes; package.json stays guarded by the environment check (plan S2). */
const NPM_ROOT_FILES = ['package.json', 'tsconfig.json', 'tsconfig.*.json', 'README.md', '.gitignore'] as const;

export const STACK_PROFILES: readonly StackProfile[] = [
  {
    id: 'minimo-node',
    title: 'Node mínimo, sin dependencias',
    whenToUse:
      'Scripts, utilidades y prototipos pequeños sin interfaz web que se resuelven con la biblioteca estándar de Node.',
    techStack: {
      lenguaje: 'JavaScript (módulos ES)',
      runtime: 'Node.js',
      pruebas: 'node:test',
      dependencias: 'ninguna',
    },
    packageManager: null,
    dependencies: [],
    devDependencies: [],
    structure: 'src/ con el código, test/ con las pruebas (*.test.js), README.md en la raíz.',
    rules: [
      'Solo biblioteca estándar de Node: no se añaden paquetes externos.',
      'Módulos ES ("type": "module") con import/export nombrados.',
      'Pruebas con node:test y node:assert/strict en test/, una por módulo de src/.',
    ],
    verificationCommands: ['node --test'],
    writablePaths: ['package.json', 'README.md', '.gitignore', 'test/**'],
    scaffold:
      'Crea package.json sin dependencias ("type": "module"), la estructura del perfil, un README con cómo ejecutar y probar, y una prueba de humo que pase con "node --test".',
    reviewedAt: REVIEWED,
  },
  {
    id: 'web-spa-react',
    title: 'Aplicación web (SPA) con React',
    whenToUse: 'Aplicaciones web con interfaz que corren en el navegador, sin servidor propio o con una API externa.',
    techStack: {
      lenguaje: 'TypeScript',
      interfaz: 'React',
      build: 'Vite',
      pruebas: 'Vitest + Testing Library (jsdom)',
      estilos: 'CSS con variables (tokens de diseño)',
    },
    packageManager: 'npm',
    dependencies: ['react', 'react-dom'],
    devDependencies: [
      'typescript',
      'vite',
      '@vitejs/plugin-react',
      'vitest',
      'jsdom',
      '@testing-library/react',
      '@testing-library/user-event',
      '@types/react',
      '@types/react-dom',
    ],
    structure:
      'index.html y vite.config.ts en la raíz; src/main.tsx, src/App.tsx, src/components/ (un componente por archivo), src/lib/ (lógica sin interfaz), src/styles/tokens.css; pruebas junto al código (*.test.tsx).',
    rules: [
      'TypeScript estricto ("strict": true), sin any; tipos de props explícitos.',
      'Componentes de función en PascalCase, uno por archivo en src/components; la lógica sin interfaz vive en src/lib y se prueba sin renderizar.',
      'Estado local con hooks; nada de estado global hasta que dos pantallas lo compartan.',
      'Pruebas con Testing Library buscando por rol y texto visible, nunca por clases o detalles internos.',
      'Estilos con las variables de src/styles/tokens.css, sin colores ni medidas sueltas; HTML semántico, etiquetas en los formularios y foco visible.',
    ],
    verificationCommands: [...TS_VERIFY],
    writablePaths: [...NPM_ROOT_FILES, 'index.html', 'vite.config.ts', 'public/**'],
    scaffold: `${NPM_SCAFFOLD} En vite.config.ts configura Vitest con environment "jsdom".`,
    reviewedAt: REVIEWED,
  },
  {
    id: 'api-node',
    title: 'API HTTP con Node',
    whenToUse: 'Servicios y APIs HTTP (REST/JSON) sin interfaz propia.',
    techStack: { lenguaje: 'TypeScript', runtime: 'Node.js', http: 'Fastify', validación: 'Zod', pruebas: 'Vitest' },
    packageManager: 'npm',
    dependencies: ['fastify', 'zod'],
    devDependencies: ['typescript', 'vitest', '@types/node'],
    structure:
      'src/server.ts (arranque), src/app.ts (construye la instancia sin escuchar), src/routes/ (un archivo por recurso), src/domain/ (reglas sin Fastify); pruebas en test/ (*.test.ts).',
    rules: [
      'TypeScript estricto ("strict": true), sin any.',
      'Una ruta por recurso en src/routes; el dominio en src/domain no importa Fastify.',
      'Valida body, params y query con esquemas de Zod en el borde; responde errores con el código HTTP correcto y un cuerpo {"error": "..."}.',
      'Las pruebas usan app.inject() sobre la instancia de src/app.ts, sin abrir puertos.',
    ],
    verificationCommands: [...TS_VERIFY],
    writablePaths: [...NPM_ROOT_FILES, 'test/**', 'vitest.config.ts'],
    scaffold: NPM_SCAFFOLD,
    reviewedAt: REVIEWED,
  },
  {
    id: 'cli-node',
    title: 'Herramienta de línea de comandos con Node',
    whenToUse: 'Herramientas de terminal con argumentos, archivos y salida por consola.',
    techStack: { lenguaje: 'TypeScript', runtime: 'Node.js', argumentos: 'node:util parseArgs', pruebas: 'Vitest' },
    packageManager: 'npm',
    dependencies: [],
    devDependencies: ['typescript', 'vitest', '@types/node'],
    structure:
      'src/cli.ts (lee argumentos y llama al núcleo), src/core/ (lógica pura que recibe datos y devuelve resultados); pruebas en test/ (*.test.ts).',
    rules: [
      'TypeScript estricto ("strict": true), sin any.',
      'src/cli.ts solo traduce argumentos y salida; la lógica vive en src/core y no lee process.argv ni escribe en consola.',
      'Códigos de salida: 0 si todo fue bien, 1 en error de uso con un mensaje claro en stderr.',
    ],
    verificationCommands: [...TS_VERIFY],
    writablePaths: [...NPM_ROOT_FILES, 'test/**', 'vitest.config.ts'],
    scaffold: NPM_SCAFFOLD,
    reviewedAt: REVIEWED,
  },
  {
    id: 'minimo-python',
    title: 'Python mínimo, sin dependencias',
    whenToUse: 'Scripts y utilidades en Python que se resuelven con la biblioteca estándar.',
    techStack: { lenguaje: 'Python 3', pruebas: 'unittest', dependencias: 'ninguna' },
    packageManager: null,
    dependencies: [],
    devDependencies: [],
    structure: 'src/<paquete>/ con el código, tests/ con las pruebas (test_*.py), README.md en la raíz.',
    rules: [
      'Solo biblioteca estándar de Python: no se añaden paquetes externos.',
      'Anotaciones de tipos en las funciones públicas.',
      'Pruebas con unittest en tests/, una por módulo.',
    ],
    verificationCommands: ['python3 -m unittest discover -s tests'],
    writablePaths: ['README.md', '.gitignore', 'pyproject.toml'],
    scaffold:
      'Crea la estructura del perfil, un README con cómo ejecutar y probar, y una prueba de humo que pase con "python3 -m unittest discover -s tests".',
    reviewedAt: REVIEWED,
  },
];

export function findStackProfile(id: string | null | undefined): StackProfile | null {
  return STACK_PROFILES.find(profile => profile.id === id) ?? null;
}

/** Every package a profile installs: what the app may install without asking (plan S2). */
export function profilePackages(profile: StackProfile): string[] {
  return [...profile.dependencies, ...profile.devDependencies];
}

/** The catalog as compact data for the inception prompt (token cost matters). */
export function catalogForPrompt(): Array<Pick<StackProfile, 'id' | 'title' | 'whenToUse' | 'techStack'>> {
  return STACK_PROFILES.map(({ id, title, whenToUse, techStack }) => ({ id, title, whenToUse, techStack }));
}

const MAX_RULES = 20,
  MAX_STACK_KEYS = 12;
const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * Merges a stack profile into the proposed project profile. The catalog wins where it is the authority: its stack keys
 * override the model's, its verification commands replace the model's, and the rules go app → profile → project
 * (duplicates removed, within the profile limits).
 */
export function applyStackProfile(proposed: ProjectProfile, profile: StackProfile): ProjectProfile {
  const techStack: Record<string, string> = { ...profile.techStack };
  for (const [key, value] of Object.entries(proposed.techStack))
    if (Object.keys(techStack).length < MAX_STACK_KEYS && !Object.keys(techStack).some(existing => same(existing, key)))
      techStack[key] = value;
  const rules: string[] = [];
  for (const rule of [...APP_RULES, ...profile.rules, ...proposed.rules])
    if (rule.trim() && rules.length < MAX_RULES && !rules.some(existing => same(existing, rule)))
      rules.push(rule.trim());
  return {
    ...proposed,
    stackProfileId: profile.id,
    techStack,
    rules,
    verificationCommands: [...profile.verificationCommands],
  };
}

/** Plan S2: what the app installs in a run's worktree and what the agent may add without asking. */
export interface ProjectEnvironment {
  /** null: the project follows no catalog profile (an existing repository): the app installs what its manifest declares. */
  stackProfileId: string | null;
  /** `npm` for a catalog profile; `detect` reads the repository's lockfile (npm or pnpm). */
  packageManager: 'npm' | 'detect';
  dependencies: string[];
  devDependencies: string[];
  /** The profile's packages plus the ones the user approved. */
  allowedPackages: string[];
  /** Paths the app owns in the worktree: never audited as the agent's changes, never writable by the agent. */
  paths: string[];
}

/** Package names npm accepts (lowercase, optional scope); also what the user may approve. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The environment of a project: its profile's packages, the repository's own manifest when it follows no profile, or null when its profile installs nothing. */
export function environmentFor(
  stackProfileId: string | null | undefined,
  approved: readonly string[] = [],
): ProjectEnvironment | null {
  const profile = findStackProfile(stackProfileId);
  const valid = approved.filter(name => PACKAGE_NAME.test(name));
  // An existing repository (no profile): what its package.json already declares is its environment; new packages ask.
  if (!profile)
    return {
      stackProfileId: null,
      packageManager: 'detect',
      dependencies: [],
      devDependencies: [],
      allowedPackages: [...new Set(valid)],
      paths: ['node_modules'],
    };
  if (profile.packageManager !== 'npm') return null;
  return {
    stackProfileId: profile.id,
    packageManager: 'npm',
    dependencies: [...profile.dependencies],
    devDependencies: [...profile.devDependencies],
    allowedPackages: [...new Set([...profilePackages(profile), ...approved.filter(name => PACKAGE_NAME.test(name))])],
    paths: ['node_modules'],
  };
}
