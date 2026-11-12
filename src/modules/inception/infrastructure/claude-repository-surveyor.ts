import { ClaudeChangeSetPlanner, type ClaudeChangeSetPlannerOptions } from '../../planning/index.js';
import { trackedFiles, withBaseCheckout } from '../../execution/index.js';
import type { RepositorySurveyorPort } from '../application/ports/inception-port.js';
import { buildSurveyPrompt } from './prompts/survey-prompt.js';
import { surveySchema } from './survey-contract.js';

/** Turns the survey may take: enough to explore a medium repository with haiku, small enough to stay cheap. */
export const SURVEY_MAX_TURNS = 40;
/** The survey reads code for a while; its own limit, longer than a plain inception call. */
export const SURVEY_TIMEOUT_MS = 900_000;
/**
 * No user or repository settings reach the survey: `--setting-sources ''` keeps the repository's hooks and permission
 * rules out (with `project,local`, hooks in its .claude/settings.json would run; checked with CLI 2.1.318).
 */
const SURVEY_ISOLATION_ARGS = ['--setting-sources', '', '--disable-slash-commands'] as const;

/**
 * Plan REP, R3: the read-only survey with `claude -p --json-schema` on a throwaway copy of the base branch. Read, Glob
 * and Grep are the only tools, allowed only inside that copy (`dontAsk` denies the rest, checked with the CLI), and the
 * copy is removed afterwards. It returns `git ls-files` of that commit so the service keeps only real evidence.
 */
export class ClaudeRepositorySurveyor implements RepositorySurveyorPort {
  private readonly runner: ClaudeChangeSetPlanner;
  constructor(
    cwd: string,
    private readonly checkout: {
      workspaceRoot: string;
      repositoryOf(projectId: string): string | null;
      configuredBase(projectId: string): string | null;
    },
    options: ClaudeChangeSetPlannerOptions = {},
    private readonly maxTurns = SURVEY_MAX_TURNS,
  ) {
    this.runner = new ClaudeChangeSetPlanner(cwd, { timeoutMs: SURVEY_TIMEOUT_MS, ...options });
  }

  async survey(input: Parameters<RepositorySurveyorPort['survey']>[0]) {
    const path = this.checkout.repositoryOf(input.projectId);
    if (!path) throw new Error('El proyecto no tiene repositorio configurado.');
    const where = {
      repositoryPath: path,
      configuredBase: this.checkout.configuredBase(input.projectId),
      workspaceRoot: this.checkout.workspaceRoot,
      projectId: input.projectId,
    };
    return withBaseCheckout(where, async (directory, at) => {
      const tracked = await trackedFiles(directory);
      const { output, usage } = await this.runner.structured(
        buildSurveyPrompt(input.scan, this.maxTurns),
        surveySchema,
        input.model,
        [...SURVEY_ISOLATION_ARGS, '--max-turns', String(this.maxTurns)],
        input.signal,
        {
          tools: 'Read,Glob,Grep',
          allowedTools: 'Read(./**)',
          cwd: directory,
          purpose: 'leer el código del repositorio',
        },
      );
      return { raw: output, tracked, ref: at.ref, commit: at.commit, usage };
    });
  }
}
