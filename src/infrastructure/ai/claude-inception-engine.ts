import type { InceptionEnginePort } from '../../application/ports/inception-port.js';
import { ClaudeChangeSetPlanner, type ClaudeChangeSetPlannerOptions } from './claude-change-set-planner.js';
import { CLAUDE_ISOLATION_ARGS } from './claude-code-adapter.js';
import { buildProposalPrompt, buildQuestionsPrompt, buildUiExplorationPrompt, parseProposal, parseQuestions, parseUiOptions, proposalSchema, questionsSchema, uiExplorationSchema } from './inception-contract.js';

/** Inception gates on `claude -p --json-schema`, without tools or session, and without the user's CLI settings or skills. `signal` stops the CLI. */
export class ClaudeInceptionEngine implements InceptionEnginePort {
  private readonly runner: ClaudeChangeSetPlanner;
  constructor(cwd: string, options: ClaudeChangeSetPlannerOptions = {}) { this.runner = new ClaudeChangeSetPlanner(cwd, { timeoutMs: 600_000, ...options }); }

  async askGoals(input: Parameters<InceptionEnginePort['askGoals']>[0]) {
    const { output, usage } = await this.runner.structured(buildQuestionsPrompt(input.project), questionsSchema, input.model, CLAUDE_ISOLATION_ARGS, input.signal);
    return { ...parseQuestions(output, 'Claude Code'), usage };
  }

  async propose(input: Parameters<InceptionEnginePort['propose']>[0]) {
    const { output, usage } = await this.runner.structured(buildProposalPrompt(input.project, input.questions, input.answers, input.notes), proposalSchema, input.model, CLAUDE_ISOLATION_ARGS, input.signal);
    return { ...parseProposal(output, 'Claude Code'), usage };
  }

  async exploreUi(input: Parameters<InceptionEnginePort['exploreUi']>[0]) {
    const { output, usage } = await this.runner.structured(buildUiExplorationPrompt(input.project, input.questions, input.answers, input.revise), uiExplorationSchema, input.model, CLAUDE_ISOLATION_ARGS, input.signal);
    return { ...parseUiOptions(output, 'Claude Code', input.revise ? 1 : 3), usage };
  }
}
