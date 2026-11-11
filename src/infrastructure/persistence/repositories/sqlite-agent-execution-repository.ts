import { normalizeDecisionPolicy } from '../../../domain/autonomy/decision-policy.js';
import { randomUUID } from 'node:crypto';
import type { AgentExecution, AgentEvent, AgentProfile, AgentProvider, AgentProviderId, ExecutionStatus } from '../../../domain/agents/models.js';
import type { AutonomyPolicy,ApprovalRequest } from '../../../domain/governance/models.js';
import { canTransitionWorkItem, type WorkItem, type AcceptanceCriterion, type WorkItemStatus } from '../../../domain/work-management/entities.js';
import type { AgentExecutionProfile, AgentExecutionRepositoryPort } from '../../../application/ports/agent-execution-port.js';
import type { SqliteDatabase } from '../sqlite/database.js';
import type { ExecutionFileDiff } from '../../execution/execution-validator.js';
import { parseConnectionConfig, providerDefaults } from '../../ai/provider-catalog.js';
import type { TaskOutcome } from '../../../domain/work-management/task-outcome.js';


export class SqliteAgentExecutionRepository implements AgentExecutionRepositoryPort {
  private readonly seeded = new Set<string>();
  /** `providerKey` is the adapter wired into this process; its provider and DEVELOPER profile are seeded per project. */
  constructor(private readonly db: SqliteDatabase, private readonly providerKey: AgentProviderId = 'claude-code') {}

  listProfiles(projectId: string): AgentExecutionProfile[] {
    this.ensureDefaults(projectId);
    const rows = this.db.prepare(`SELECT p.*,v.provider_key,v.display_name,v.adapter_version,v.capabilities_json,c.config_json
      FROM agent_profiles p JOIN agent_providers v ON v.id=p.default_provider_id
      LEFT JOIN provider_connections c ON c.id=v.id||':local'
      WHERE p.project_id=? ORDER BY p.role_key,p.name`).all(projectId) as ProfileRow[];
    return rows.map(row => {
      const config=parseConnectionConfig(row.config_json);
      const available=(config.models?.available??[]).filter((model):model is string=>typeof model==='string');
      const roleDefault=row.role_key==='PLANNER'?config.models?.planning:config.models?.execution;
      return {...mapProfile(row),provider:mapProvider(row),models:{default:typeof roleDefault==='string'?roleDefault:null,planning:typeof config.models?.planning==='string'?config.models.planning:null,available},connectionConfig:config as Record<string,unknown>};
    });
  }

  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null {
    return this.listProfiles(projectId).find(profile => profile.id === profileId) ?? null;
  }

  findWorkItem(projectId: string, workItemId: string): WorkItem | null {
    const row = this.db.prepare(`SELECT e.*,w.work_type,w.priority AS work_priority,w.scope_notes,w.acceptance_criteria_json,w.recommended_profile_role
      FROM knowledge_entities e JOIN work_items w ON w.entity_id=e.id
      WHERE e.project_id=? AND e.id=? AND e.entity_type='WORK_ITEM'`).get(projectId,workItemId) as WorkItemRow|undefined;
    if (!row) return null;
    return {
      id:row.id,projectId:row.project_id,entityType:'WORK_ITEM',displayKey:row.display_key,title:row.title,summary:row.summary,status:row.status,parentId:row.parent_id,
      createdRevision:row.created_revision,updatedRevision:row.updated_revision,createdAt:row.created_at,updatedAt:row.updated_at,
      workType:row.work_type,priority:row.work_priority,scopeNotes:row.scope_notes,acceptanceCriteria:parseCriteria(row.acceptance_criteria_json),recommendedProfileRole:row.recommended_profile_role,
    };
  }

  getRepositoryRoot(projectId: string): string | null {
    const row=this.db.prepare('SELECT local_path FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1').get(projectId) as {local_path:string}|undefined;
    return row?.local_path??null;
  }

  getRepositoryId(projectId:string):string|null {const row=this.db.prepare('SELECT id FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1').get(projectId) as {id:string}|undefined;return row?.id??null;}

  getAutonomyPolicy(projectId:string,profileId:string):AutonomyPolicy {
    this.ensureDefaults(projectId);
    const row=this.db.prepare(`SELECT a.* FROM autonomy_policies a JOIN agent_profiles p ON p.default_policy_id=a.id WHERE p.project_id=? AND p.id=?`).get(projectId,profileId) as PolicyRow|undefined;
    if(!row)throw new Error('No hay una política de autonomía asignada al perfil.');
    return {id:row.id,projectId:row.project_id,name:row.name,writablePaths:parseArray(row.writable_paths_json),readonlyPaths:parseArray(row.readonly_paths_json),deniedPaths:parseArray(row.denied_paths_json),allowedCommands:parseArray(row.allowed_commands_json),autoApproveScopes:parseArray(row.auto_approve_scopes_json),requireWorktreeIsolation:Boolean(row.require_worktree_isolation),maxExecutionMinutes:row.max_execution_minutes??30,decisionPolicy:readDecisionPolicy(row.decision_policy_json)};
  }

  updateAutonomyPolicy(policyId:string,fields:Pick<AutonomyPolicy,'writablePaths'|'readonlyPaths'|'deniedPaths'|'allowedCommands'|'maxExecutionMinutes'|'decisionPolicy'>):void {
    const result=this.db.prepare('UPDATE autonomy_policies SET writable_paths_json=?,readonly_paths_json=?,denied_paths_json=?,allowed_commands_json=?,max_execution_minutes=?,decision_policy_json=? WHERE id=?')
      .run(JSON.stringify(fields.writablePaths),JSON.stringify(fields.readonlyPaths),JSON.stringify(fields.deniedPaths),JSON.stringify(fields.allowedCommands),fields.maxExecutionMinutes,JSON.stringify(fields.decisionPolicy),policyId);
    if(result.changes!==1)throw new Error('La política de autonomía no existe.');
  }

  setProviderAuthMode(projectId:string,mode:'subscription'|'api_key'):void {
    this.ensureDefaults(projectId);
    const providerId=(this.db.prepare('SELECT id FROM agent_providers WHERE provider_key=?').get(this.providerKey) as {id:string}).id;
    const row=this.db.prepare('SELECT config_json FROM provider_connections WHERE id=?').get(`${providerId}:local`) as {config_json:string|null}|undefined;
    const config={...parseConnectionConfig(row?.config_json??null),authMode:mode};
    this.db.prepare('UPDATE provider_connections SET config_json=? WHERE id=?').run(JSON.stringify(config),`${providerId}:local`);
  }

  rejectPendingApprovals(executionId:string,note:string):void {
    this.db.prepare(`UPDATE approval_requests SET status='REJECTED',resolved_by='SYSTEM',resolution_note=?,resolved_at=? WHERE execution_id=? AND status='PENDING'`).run(note,new Date().toISOString(),executionId);
  }

  createApprovalRequest(request:ApprovalRequest):void {this.db.prepare(`INSERT INTO approval_requests(id,execution_id,scope,requested_action,reason,status,requested_at) VALUES(?,?,?,?,?,'PENDING',?)`).run(request.id,request.executionId,request.scope,request.requestedAction,request.reason,request.requestedAt);}

  resolveApprovalRequest(requestId:string,decision:{approved:boolean;resolvedBy:string;note:string}):void {
    const result=this.db.prepare(`UPDATE approval_requests SET status=?,resolved_by=?,resolution_note=?,resolved_at=? WHERE id=? AND status='PENDING'`).run(decision.approved?'APPROVED':'REJECTED',decision.resolvedBy,decision.note,new Date().toISOString(),requestId);
    if(result.changes!==1)throw new Error('La solicitud de aprobación ya fue resuelta o no existe.');
  }

  transitionWorkItem(projectId:string,workItemId:string,to:WorkItemStatus):number {
    return this.db.transaction(()=>{
      const row=this.db.prepare(`SELECT e.status,p.current_revision FROM knowledge_entities e JOIN projects p ON p.id=e.project_id WHERE e.project_id=? AND e.id=? AND e.entity_type='WORK_ITEM'`).get(projectId,workItemId) as {status:WorkItemStatus;current_revision:number}|undefined;
      if(!row)throw new Error('La tarea no existe en este proyecto.');
      if(!canTransitionWorkItem(row.status,to))throw new Error(`Transición de tarea inválida: ${row.status} -> ${to}`);
      const revision=row.current_revision+1,now=new Date().toISOString();
      this.db.prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=?').run(to,revision,now,workItemId);
      this.db.prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?').run(revision,now,projectId);
      return revision;
    }).immediate();
  }

  listDependencies(projectId:string,workItemId:string):Array<{id:string;displayKey:string;title:string;status:string}> {
    return (this.db.prepare(`SELECT k.id,k.display_key,k.title,k.status FROM graph_edges g JOIN knowledge_entities k ON k.id=g.target_id
      WHERE g.project_id=? AND g.source_id=? AND g.edge_type='DEPENDS_ON' AND k.entity_type='WORK_ITEM' ORDER BY k.display_key`).all(projectId,workItemId) as Array<{id:string;display_key:string;title:string;status:string}>)
      .map(row=>({id:row.id,displayKey:row.display_key,title:row.title,status:row.status}));
  }

  listDependents(projectId:string,workItemId:string):Array<{id:string;displayKey:string;title:string;status:string}> {
    return (this.db.prepare(`SELECT k.id,k.display_key,k.title,k.status FROM graph_edges g JOIN knowledge_entities k ON k.id=g.source_id
      WHERE g.project_id=? AND g.target_id=? AND g.edge_type='DEPENDS_ON' AND k.entity_type='WORK_ITEM' ORDER BY k.display_key`).all(projectId,workItemId) as Array<{id:string;display_key:string;title:string;status:string}>)
      .map(row=>({id:row.id,displayKey:row.display_key,title:row.title,status:row.status}));
  }

  listFeatureTasks(projectId:string,featureId:string):Array<{id:string;displayKey:string;title:string;status:string}> {
    return (this.db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM knowledge_entities WHERE project_id=? AND parent_id=? AND entity_type='WORK_ITEM'
      UNION SELECT k.id FROM knowledge_entities k JOIN tree t ON k.parent_id=t.id WHERE k.entity_type='WORK_ITEM')
      SELECT k.id,k.display_key,k.title,k.status FROM knowledge_entities k JOIN tree t ON t.id=k.id ORDER BY k.display_key`).all(projectId,featureId) as Array<{id:string;display_key:string;title:string;status:string}>)
      .map(row=>({id:row.id,displayKey:row.display_key,title:row.title,status:row.status}));
  }

  findFeatureFor(projectId:string,workItemId:string):{id:string;displayKey:string;title:string}|null {
    const lookup=this.db.prepare('SELECT id,entity_type,display_key,title,parent_id FROM knowledge_entities WHERE project_id=? AND id=?');
    let current=lookup.get(projectId,workItemId) as {id:string;entity_type:string;display_key:string;title:string;parent_id:string|null}|undefined;
    for(let depth=0;current&&depth<16;depth+=1){
      if(current.entity_type==='FEATURE')return {id:current.id,displayKey:current.display_key,title:current.title};
      current=current.parent_id?lookup.get(projectId,current.parent_id) as typeof current:undefined;
    }
    return null;
  }

  getIntegrationBranch(ownerId:string):{branchName:string;sourceBranch:string}|null {
    const row=this.db.prepare('SELECT branch_name,source_branch FROM feature_branches WHERE feature_id=?').get(ownerId) as {branch_name:string;source_branch:string}|undefined;
    return row?{branchName:row.branch_name,sourceBranch:row.source_branch}:null;
  }

  saveIntegrationBranch(input:{ownerId:string;projectId:string;repositoryId:string;branchName:string;sourceBranch:string}):void {
    this.db.prepare(`INSERT INTO feature_branches(feature_id,project_id,repository_id,branch_name,source_branch,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(feature_id) DO UPDATE SET branch_name=excluded.branch_name,source_branch=excluded.source_branch`).run(input.ownerId,input.projectId,input.repositoryId,input.branchName,input.sourceBranch,new Date().toISOString());
  }

  listDocumentPaths(projectId:string):string[] {
    return (this.db.prepare(`SELECT a.relative_path AS path FROM artifacts a JOIN knowledge_entities e ON e.id=a.entity_id WHERE e.project_id=?
      UNION SELECT d.relative_path FROM decision_records d JOIN knowledge_entities e ON e.id=d.entity_id WHERE e.project_id=? ORDER BY 1`).all(projectId,projectId) as Array<{path:string}>).map(row=>row.path);
  }

  recordTaskOutcome(outcome:TaskOutcome,repositoryId:string):number {
    return this.db.transaction(()=>{
      const project=this.db.prepare('SELECT current_revision FROM projects WHERE id=?').get(outcome.projectId) as {current_revision:number}|undefined;
      if(!project)throw new Error('Proyecto no encontrado.');
      const revision=project.current_revision+1,now=new Date().toISOString();
      this.db.prepare(`INSERT INTO task_outcomes(work_item_id,project_id,execution_id,summary,files_json,checks_json,merged_commit,integration_branch,created_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(work_item_id) DO UPDATE SET execution_id=excluded.execution_id,summary=excluded.summary,files_json=excluded.files_json,checks_json=excluded.checks_json,merged_commit=excluded.merged_commit,integration_branch=excluded.integration_branch,created_at=excluded.created_at`)
        .run(outcome.workItemId,outcome.projectId,outcome.executionId,outcome.summary,JSON.stringify(outcome.files),JSON.stringify(outcome.checks),outcome.mergedCommit,outcome.integrationBranch,outcome.createdAt);
      const documents=new Map((this.db.prepare(`SELECT a.relative_path AS path,a.entity_id AS id FROM artifacts a JOIN knowledge_entities e ON e.id=a.entity_id WHERE e.project_id=?
        UNION SELECT d.relative_path,d.entity_id FROM decision_records d JOIN knowledge_entities e ON e.id=d.entity_id WHERE e.project_id=?`).all(outcome.projectId,outcome.projectId) as Array<{path:string;id:string}>).map(row=>[row.path,row.id]));
      const edgeExists=this.db.prepare('SELECT 1 FROM graph_edges WHERE project_id=? AND source_id=? AND target_id=? AND edge_type=?');
      const addEdge=(source:string,target:string,type:'MODIFIES'|'GENERATED_BY')=>{if(!edgeExists.get(outcome.projectId,source,target,type))this.db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'EXECUTION',NULL,?,NULL,?,?)`).run(randomUUID(),outcome.projectId,source,target,type,outcome.executionId,revision,now);};
      const findCode=this.db.prepare(`SELECT c.entity_id FROM code_references c JOIN knowledge_entities e ON e.id=c.entity_id WHERE e.project_id=? AND c.file_path=?`);
      for(const file of outcome.files){
        const documentId=documents.get(file.path);
        if(documentId){addEdge(documentId,outcome.workItemId,'GENERATED_BY');continue;}
        const status=file.status==='DELETED'?'REMOVED':'ACTIVE';
        let codeId=(findCode.get(outcome.projectId,file.path) as {entity_id:string}|undefined)?.entity_id;
        if(codeId){
          this.db.prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=?').run(status,revision,now,codeId);
          this.db.prepare('UPDATE code_references SET commit_sha=? WHERE entity_id=?').run(outcome.mergedCommit??'',codeId);
        }else{
          codeId=randomUUID();
          this.db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'CODE_REFERENCE',?,?,'',?,NULL,?,?,?,?)`).run(codeId,outcome.projectId,this.nextDisplayKey(outcome.projectId,'CODE'),file.path,status,revision,revision,now,now);
          this.db.prepare('INSERT INTO code_references(entity_id,repository_id,file_path,commit_sha) VALUES(?,?,?,?)').run(codeId,repositoryId,file.path,outcome.mergedCommit??'');
        }
        addEdge(outcome.workItemId,codeId,'MODIFIES');
      }
      this.db.prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?').run(revision,now,outcome.projectId);
      return revision;
    }).immediate();
  }

  externalSessionId(sessionId:string):string|null {
    return (this.db.prepare('SELECT external_session_id FROM agent_sessions WHERE id=?').get(sessionId) as {external_session_id:string|null}|undefined)?.external_session_id??null;
  }

  findTaskOutcome(workItemId:string):TaskOutcome|null {
    const row=this.db.prepare('SELECT * FROM task_outcomes WHERE work_item_id=?').get(workItemId) as {work_item_id:string;project_id:string;execution_id:string;summary:string;files_json:string;checks_json:string;merged_commit:string|null;integration_branch:string|null;created_at:string}|undefined;
    if(!row)return null;
    return {workItemId:row.work_item_id,projectId:row.project_id,executionId:row.execution_id,summary:row.summary,files:parseJson(row.files_json,[]),checks:parseJson(row.checks_json,[]),mergedCommit:row.merged_commit,integrationBranch:row.integration_branch,createdAt:row.created_at};
  }

  private nextDisplayKey(projectId:string,prefix:string):string {
    const rows=this.db.prepare('SELECT display_key FROM knowledge_entities WHERE project_id=? AND display_key LIKE ?').all(projectId,`${prefix}-%`) as Array<{display_key:string}>;
    const max=Math.max(0,...rows.map(row=>Number(row.display_key.slice(prefix.length+1))||0));
    return `${prefix}-${String(max+1).padStart(3,'0')}`;
  }

  listFileDiffs(executionId:string):Array<{filePath:string;changeType:string;additions:number;deletions:number;diffPatch:string|null}> {
    return (this.db.prepare('SELECT file_path,change_type,additions,deletions,diff_patch FROM execution_file_diffs WHERE execution_id=? ORDER BY file_path').all(executionId) as Array<{file_path:string;change_type:string;additions:number;deletions:number;diff_patch:string|null}>)
      .map(row=>({filePath:row.file_path,changeType:row.change_type,additions:row.additions,deletions:row.deletions,diffPatch:row.diff_patch}));
  }

  recordFileDiffs(executionId:string,repositoryId:string,diffs:ExecutionFileDiff[]):void {
    const insert=this.db.prepare(`INSERT INTO execution_file_diffs(id,execution_id,repository_id,file_path,change_type,additions,deletions,diff_patch) VALUES(?,?,?,?,?,?,?,?)`);
    this.db.transaction(()=>{for(const diff of diffs)insert.run(randomUUID(),executionId,repositoryId,diff.filePath,diff.changeType,diff.additions,diff.deletions,diff.diffPatch);}).immediate();
  }

  createExecution(execution: AgentExecution): void {
    this.db.prepare(`INSERT INTO agent_executions
      (id,project_id,work_item_id,profile_id,provider_id,session_id,context_snapshot_id,status,model_used,initial_commit,final_commit,branch_or_worktree,base_branch,execution_branch,revision_of,review_status,review_note,merged_commit,reviewed_at,test_summary_json,result_summary,started_at,completed_at)
      VALUES (@id,@projectId,@workItemId,@profileId,@providerId,@sessionId,@contextSnapshotId,@status,@modelUsed,@initialCommit,@finalCommit,@branchOrWorktree,@baseBranch,@executionBranch,@revisionOf,@reviewStatus,@reviewNote,@mergedCommit,@reviewedAt,@testSummary,@resultSummary,@startedAt,@completedAt)`).run(toRow(execution));
  }

  updateExecution(execution: AgentExecution): void {
    const result=this.db.prepare(`UPDATE agent_executions SET session_id=@sessionId,context_snapshot_id=@contextSnapshotId,status=@status,model_used=@modelUsed,
      initial_commit=@initialCommit,final_commit=@finalCommit,branch_or_worktree=@branchOrWorktree,base_branch=@baseBranch,execution_branch=@executionBranch,revision_of=@revisionOf,review_status=@reviewStatus,review_note=@reviewNote,merged_commit=@mergedCommit,reviewed_at=@reviewedAt,
      test_summary_json=@testSummary,result_summary=@resultSummary,started_at=@startedAt,completed_at=@completedAt WHERE id=@id`).run(toRow(execution));
    if (result.changes!==1) throw new Error(`AgentExecution not found: ${execution.id}`);
  }

  findExecution(executionId: string): AgentExecution | null {
    const row=this.db.prepare('SELECT * FROM agent_executions WHERE id=?').get(executionId) as ExecutionRow|undefined;
    return row?mapExecution(row):null;
  }

  listExecutions(projectId: string): AgentExecution[] {
    return (this.db.prepare('SELECT * FROM agent_executions WHERE project_id=? ORDER BY COALESCE(started_at,completed_at) DESC,id DESC').all(projectId) as ExecutionRow[]).map(mapExecution);
  }

  appendEvent(executionId: string, event: AgentEvent): {id:string;sequenceNo:number;createdAt:string} {
    const id=randomUUID(),createdAt=new Date().toISOString();
    const sequenceNo=((this.db.prepare('SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM agent_events WHERE execution_id=?').get(executionId) as {next:number}).next);
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO agent_events(id,execution_id,sequence_no,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(id,executionId,sequenceNo,event.type,JSON.stringify(event),createdAt);
      if(event.type==='SESSION_INITIALIZED') {
        const execution=this.findExecution(executionId);
        if(execution) {
          const sessionId=randomUUID();
          this.db.prepare('INSERT INTO agent_sessions(id,project_id,provider_id,profile_id,external_session_id,status,created_at,last_active_at) VALUES(?,?,?,?,?,?,?,?)').run(sessionId,execution.projectId,execution.providerId,execution.profileId,event.externalSessionId,'ACTIVE',createdAt,createdAt);
          this.db.prepare('UPDATE agent_executions SET session_id=? WHERE id=?').run(sessionId,executionId);
        }
      }
    }).immediate();
    return {id,sequenceNo,createdAt};
  }

  listEvents(executionId: string): Array<{id:string;sequenceNo:number;createdAt:string;event:AgentEvent}> {
    return (this.db.prepare('SELECT id,sequence_no,created_at,payload_json FROM agent_events WHERE execution_id=? ORDER BY sequence_no').all(executionId) as EventRow[])
      .map(row=>({id:row.id,sequenceNo:row.sequence_no,createdAt:row.created_at,event:JSON.parse(row.payload_json) as AgentEvent}));
  }

  /** Seeds the wired provider, its local connection, the default policy and the DEVELOPER profile, once per project per process. */
  private ensureDefaults(projectId: string): void {
    if(this.seeded.has(projectId))return;
    const defaults=providerDefaults(this.providerKey);
    const providerId=`provider:${defaults.providerKey}`;
    const profileId=`${projectId}:profile:developer`;
    const policyId=`${projectId}:policy:default`;
    const now=new Date().toISOString();
    const otherProfileNames=['codex','claude-code'].filter(key=>key!==defaults.providerKey).map(key=>providerDefaults(key as AgentProviderId).developerProfileName);
    this.db.transaction(()=>{
      this.db.prepare(`INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json)
        VALUES(?,?,?,?,?) ON CONFLICT(provider_key) DO UPDATE SET display_name=excluded.display_name,adapter_version=excluded.adapter_version,capabilities_json=excluded.capabilities_json`)
        .run(providerId,defaults.providerKey,defaults.displayName,defaults.adapterVersion,JSON.stringify(defaults.capabilities));
      const actualProviderId=(this.db.prepare('SELECT id FROM agent_providers WHERE provider_key=?').get(defaults.providerKey) as {id:string}).id;
      // Keep user-edited config; fill it only when missing.
      this.db.prepare(`INSERT INTO provider_connections(id,provider_id,executable_path,config_json,health_status)
        VALUES(?,?,?,?,'UNKNOWN') ON CONFLICT(id) DO UPDATE SET config_json=COALESCE(provider_connections.config_json,excluded.config_json)`)
        .run(`${actualProviderId}:local`,actualProviderId,process.env[defaults.executableEnv]??null,JSON.stringify(defaults.connectionConfig));
      this.db.prepare(`INSERT INTO autonomy_policies(id,project_id,name,writable_paths_json,readonly_paths_json,denied_paths_json,allowed_commands_json,auto_approve_scopes_json,require_worktree_isolation)
        VALUES(?,?,?,'["src/**","tests/**","docs/**","node_modules/**","dist/**","target/**","coverage/**"]','["docs/architecture/ADR/**"]','[".env*",".git/config"]','[]','[]',1) ON CONFLICT(id) DO NOTHING`).run(policyId,projectId,'Default isolated execution policy');
      // Existing projects move to the wired provider; a profile renamed by the user keeps its name.
      this.db.prepare(`INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions,default_provider_id,default_policy_id)
        VALUES(?,?,'DEVELOPER',?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET default_provider_id=excluded.default_provider_id,default_policy_id=COALESCE(agent_profiles.default_policy_id,excluded.default_policy_id),
          name=CASE WHEN agent_profiles.name IN (SELECT value FROM json_each(?)) THEN excluded.name ELSE agent_profiles.name END`)
        .run(profileId,projectId,defaults.developerProfileName,'Implementa el WorkItem seleccionado siguiendo estrictamente su ContextSnapshot, los criterios de aceptación y las políticas del proyecto. Mantén el alcance acotado a la tarea. No reveles credenciales ni alteres configuración local.',actualProviderId,policyId,JSON.stringify(otherProfileNames));
      this.db.prepare('UPDATE provider_connections SET last_checked_at=COALESCE(last_checked_at,?) WHERE id=?').run(now,`${actualProviderId}:local`);
    }).immediate();
    this.seeded.add(projectId);
  }
}

interface ProfileRow {id:string;project_id:string;role_key:AgentProfile['roleKey'];name:string;system_instructions:string;default_provider_id:string|null;default_policy_id:string|null;provider_key:AgentProviderId;display_name:string;adapter_version:string;capabilities_json:string;config_json:string|null}
interface WorkItemRow {id:string;project_id:string;display_key:string;title:string;summary:string;status:string;parent_id:string|null;created_revision:number;updated_revision:number;created_at:string;updated_at:string;work_type:WorkItem['workType'];work_priority:WorkItem['priority'];scope_notes:string|null;acceptance_criteria_json:string;recommended_profile_role:WorkItem['recommendedProfileRole']}
interface ExecutionRow {id:string;project_id:string;work_item_id:string|null;profile_id:string;provider_id:string;session_id:string|null;context_snapshot_id:string|null;status:ExecutionStatus;model_used:string|null;initial_commit:string;final_commit:string|null;branch_or_worktree:string|null;base_branch:string|null;execution_branch:string|null;revision_of:string|null;review_status:AgentExecution['reviewStatus'];review_note:string|null;merged_commit:string|null;reviewed_at:string|null;test_summary_json:string|null;result_summary:string|null;started_at:string|null;completed_at:string|null}
interface EventRow {id:string;sequence_no:number;created_at:string;payload_json:string}
interface PolicyRow {id:string;project_id:string;name:string;writable_paths_json:string;readonly_paths_json:string;denied_paths_json:string;allowed_commands_json:string;auto_approve_scopes_json:string;require_worktree_isolation:number;max_execution_minutes?:number; decision_policy_json?:string|null }
function mapProfile(row:ProfileRow):AgentProfile {return {id:row.id,projectId:row.project_id,roleKey:row.role_key,name:row.name,systemInstructions:row.system_instructions,defaultProviderId:row.default_provider_id,defaultPolicyId:row.default_policy_id};}
function mapProvider(row:ProfileRow):AgentProvider {let capabilities:AgentProvider['capabilities']=providerDefaults(row.provider_key==='opencode'?'claude-code':row.provider_key).capabilities;try{capabilities=JSON.parse(row.capabilities_json) as AgentProvider['capabilities'];}catch{}return {id:row.default_provider_id??`provider:${row.provider_key}`,providerKey:row.provider_key,displayName:row.display_name,adapterVersion:row.adapter_version,capabilities};}
function mapExecution(row:ExecutionRow):AgentExecution {let testSummary:unknown|null=null;try{testSummary=row.test_summary_json?JSON.parse(row.test_summary_json):null;}catch{}return {id:row.id,projectId:row.project_id,workItemId:row.work_item_id,profileId:row.profile_id,providerId:row.provider_id,sessionId:row.session_id,contextSnapshotId:row.context_snapshot_id,status:row.status,modelUsed:row.model_used,initialCommit:row.initial_commit,finalCommit:row.final_commit,branchOrWorktree:row.branch_or_worktree,baseBranch:row.base_branch??null,executionBranch:row.execution_branch??null,revisionOf:row.revision_of??null,reviewStatus:row.review_status??null,reviewNote:row.review_note??null,mergedCommit:row.merged_commit??null,reviewedAt:row.reviewed_at??null,testSummary,resultSummary:row.result_summary,startedAt:row.started_at,completedAt:row.completed_at};}
function parseCriteria(json:string):AcceptanceCriterion[] {try{const value=JSON.parse(json) as unknown;if(!Array.isArray(value))return[];return value.flatMap((item,index)=>typeof item==='string'?[{id:String(index+1),description:item,verified:false}]:item&&typeof item==='object'&&typeof (item as {description?:unknown}).description==='string'?[{id:String((item as {id?:unknown}).id??index+1),description:(item as {description:string}).description,verified:Boolean((item as {verified?:unknown}).verified)}]:[]);}catch{return[];}}
function parseArray(json:string):string[]{try{const value=JSON.parse(json) as unknown;return Array.isArray(value)?value.filter((entry):entry is string=>typeof entry==='string'):[];}catch{return[];}}
function toRow(execution:AgentExecution):Record<string,unknown> {
  return {...execution,executionBranch:execution.executionBranch??null,revisionOf:execution.revisionOf??null,reviewStatus:execution.reviewStatus??null,reviewNote:execution.reviewNote??null,mergedCommit:execution.mergedCommit??null,reviewedAt:execution.reviewedAt??null,testSummary:execution.testSummary===null?null:JSON.stringify(execution.testSummary)};
}
function parseJson<T>(json:string,fallback:T):T{try{return JSON.parse(json) as T;}catch{return fallback;}}

/** A stored policy that no longer parses falls back to the defaults rather than blocking every run. */
function readDecisionPolicy(json:string|null|undefined){try{return normalizeDecisionPolicy(json?JSON.parse(json):null);}catch{return normalizeDecisionPolicy(null);}}
