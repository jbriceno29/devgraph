export interface AutonomyPolicy {
  id: string;
  projectId: string;
  name: string;
  writablePaths: string[];
  readonlyPaths: string[];
  deniedPaths: string[];
  allowedCommands: string[];
  autoApproveScopes: string[];
  requireWorktreeIsolation: boolean;
  maxExecutionMinutes: number /** Tope de turnos del motor por ejecución; 0 = sin límite. */;
  maxTurns: number;
  decisionPolicy: import('../autonomy/decision-policy.js').DecisionPolicy;
}
export interface ApprovalRequest {
  id: string;
  executionId: string;
  scope: string;
  requestedAction: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  resolvedBy: string | null;
  resolutionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}
