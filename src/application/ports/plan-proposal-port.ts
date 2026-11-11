import type { ChangeOperation, ChangeSetStatus } from '../../domain/knowledge/change-set.js';

/** A plan change an agent proposes when it closes a task (```propuestas block of its summary). */
export interface PlanProposal { title:string; rationale:string; operations:ChangeOperation[] }

/**
 * Where the orchestrator sends the agent's plan proposals: stored as a ChangeSet (origin AGENT_EXECUTION) and
 * validated against the graph; applied only when the project's decision policy allows it.
 */
export interface PlanProposalPort {
  /** Validates and normalizes the agent's JSON operations (throws on an invalid one). */
  normalize(operations:unknown[]):ChangeOperation[];
  /** Saves the proposal as a ChangeSet and validates it; `issues` are the validator's errors when it is not VALIDATED. */
  submit(projectId:string,proposal:PlanProposal,originRefId:string):Promise<{changeSetId:string;status:ChangeSetStatus;issues:string[]}>;
  /** Applies a VALIDATED ChangeSet; `resolvedIds` maps each tempId to the id it got. */
  apply(changeSetId:string):Promise<{revision:number;resolvedIds:Record<string,string>}>;
  /** Operations of the project's APPLIED ChangeSets proposed by agents (to count the tasks they already added). */
  appliedAgentOperations(projectId:string):ChangeOperation[][];
}
