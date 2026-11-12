import { chooseUiOption, getUiPrototype, reopenDesign, reviseUiOption } from './inception-design.js';
import { answer, approve, get, restart, settled, shutdown, start } from './inception-flow.js';
import { importDesign, importPrototype } from './inception-import.js';
import { activity } from './inception-snapshot.js';
import type { InceptionKernel, ProjectInceptionDependencies } from './inception-kernel.js';

export type { InceptionPlanningPort, ProjectInceptionDependencies } from './inception-kernel.js';

/** The arguments of a use case after the kernel. */
type Rest<F> = F extends (k: InceptionKernel, ...args: infer A) => unknown ? A : never;

/**
 * Project inception (MVP with two gates, plus an optional visual exploration): ASK_GOALS → [EXPLORE_UI] → PROPOSAL (waiting for approval) → APPLIED. Engine calls run in
 * the background (the IPC call returns at once with status WORKING; `inception:updated` reports the end) and each one
 * is independent: brief, questions, answers and the proposal live in the workspace, never in an engine session.
 * The proposal is a normal ChangeSet: validated, classified by the decision policy (PROJECT_FOUNDATION always asks)
 * and applied only when the user approves it. A restart or the app shutdown aborts the running call (its process is stopped).
 *
 * A facade (A3): the flow in `inception-flow.ts`, imports in `inception-import.ts`, the visual exploration in
 * `inception-design.ts`, the engine calls in `inception-work.ts` and what the user sees in `inception-snapshot.ts`.
 */
export class ProjectInceptionService {
  private readonly k: InceptionKernel;
  constructor(deps: ProjectInceptionDependencies) {
    this.k = { deps, running: new Map(), controllers: new Map(), surveys: new Map() };
  }

  get(...args: Rest<typeof get>) {
    return get(this.k, ...args);
  }
  start(...args: Rest<typeof start>) {
    return start(this.k, ...args);
  }
  answer(...args: Rest<typeof answer>) {
    return answer(this.k, ...args);
  }
  importPrototype(...args: Rest<typeof importPrototype>) {
    return importPrototype(this.k, ...args);
  }
  importDesign(...args: Rest<typeof importDesign>) {
    return importDesign(this.k, ...args);
  }
  reviseUiOption(...args: Rest<typeof reviseUiOption>) {
    return reviseUiOption(this.k, ...args);
  }
  chooseUiOption(...args: Rest<typeof chooseUiOption>) {
    return chooseUiOption(this.k, ...args);
  }
  reopenDesign(...args: Rest<typeof reopenDesign>) {
    return reopenDesign(this.k, ...args);
  }
  getUiPrototype(...args: Rest<typeof getUiPrototype>) {
    return getUiPrototype(this.k, ...args);
  }
  approve(...args: Rest<typeof approve>) {
    return approve(this.k, ...args);
  }
  restart(...args: Rest<typeof restart>) {
    return restart(this.k, ...args);
  }
  shutdown(...args: Rest<typeof shutdown>) {
    return shutdown(this.k, ...args);
  }
  settled(...args: Rest<typeof settled>) {
    return settled(this.k, ...args);
  }
  activity(...args: Rest<typeof activity>) {
    return activity(this.k, ...args);
  }
}
