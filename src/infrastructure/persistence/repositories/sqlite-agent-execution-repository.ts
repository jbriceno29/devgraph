import { randomUUID } from 'node:crypto';
import type { AgentExecution, AgentEvent, AgentProfile, AgentProvider, AgentProviderId, ExecutionStatus } from '../../../domain/agents/models.js';
import type { WorkItem, AcceptanceCriterion } from '../../../domain/work-management/entities.js';
import type { AgentExecutionProfile, AgentExecutionRepositoryPort } from '../../../application/ports/agent-execution-port.js';
import type { SqliteDatabase } from '../sqlite/database.js';

const CODEX_CAPABILITIES = { supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true };

export class SqliteAgentExecutionRepository implements AgentExecutionRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}

  listProfiles(projectId: string): AgentExecutionProfile[] {
    this.ensureCodexDefaults(projectId);
    const rows = this.db.prepare(`SELECT p.*,v.provider_key,v.display_name,v.adapter_version,v.capabilities_json
      FROM agent_profiles p JOIN agent_providers v ON v.id=p.default_provider_id
      WHERE p.project_id=? ORDER BY p.role_key,p.name`).all(projectId) as ProfileRow[];
    return rows.map(row => ({...mapProfile(row),provider:mapProvider(row)}));
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

  createExecution(execution: AgentExecution): void {
    this.db.prepare(`INSERT INTO agent_executions
      (id,project_id,work_item_id,profile_id,provider_id,session_id,context_snapshot_id,status,model_used,initial_commit,final_commit,branch_or_worktree,test_summary_json,result_summary,started_at,completed_at)
      VALUES (@id,@projectId,@workItemId,@profileId,@providerId,@sessionId,@contextSnapshotId,@status,@modelUsed,@initialCommit,@finalCommit,@branchOrWorktree,@testSummary,@resultSummary,@startedAt,@completedAt)`).run({...execution,testSummary:execution.testSummary===null?null:JSON.stringify(execution.testSummary)});
  }

  updateExecution(execution: AgentExecution): void {
    const result=this.db.prepare(`UPDATE agent_executions SET session_id=@sessionId,context_snapshot_id=@contextSnapshotId,status=@status,model_used=@modelUsed,
      initial_commit=@initialCommit,final_commit=@finalCommit,branch_or_worktree=@branchOrWorktree,test_summary_json=@testSummary,result_summary=@resultSummary,
      started_at=@startedAt,completed_at=@completedAt WHERE id=@id`).run({...execution,testSummary:execution.testSummary===null?null:JSON.stringify(execution.testSummary)});
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

  private ensureCodexDefaults(projectId: string): void {
    const providerId='provider:codex';
    const profileId=`${projectId}:profile:developer`;
    const now=new Date().toISOString();
    this.db.transaction(()=>{
      this.db.prepare(`INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json)
        VALUES(?,?,?,?,?) ON CONFLICT(provider_key) DO UPDATE SET display_name=excluded.display_name,adapter_version=excluded.adapter_version,capabilities_json=excluded.capabilities_json`)
        .run(providerId,'codex','Codex CLI','1.0.0',JSON.stringify(CODEX_CAPABILITIES));
      const actualProviderId=(this.db.prepare('SELECT id FROM agent_providers WHERE provider_key=?').get('codex') as {id:string}).id;
      this.db.prepare(`INSERT INTO provider_connections(id,provider_id,executable_path,health_status)
        VALUES(?,?,?,'UNKNOWN') ON CONFLICT(id) DO NOTHING`).run(`${actualProviderId}:local`,actualProviderId,process.env.GRAPHDEV_CODEX_PATH??process.env.CODEX_CLI_PATH??null);
      this.db.prepare(`INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions,default_provider_id,default_policy_id)
        VALUES(?,?,'DEVELOPER','Desarrollador Codex',?, ?,NULL)
        ON CONFLICT(id) DO UPDATE SET default_provider_id=excluded.default_provider_id`)
        .run(profileId,projectId,'Implementa el WorkItem seleccionado siguiendo estrictamente su ContextSnapshot, los criterios de aceptación y las políticas del proyecto. Mantén el alcance acotado a la tarea. No reveles credenciales ni alteres configuración local.',actualProviderId);
      this.db.prepare('UPDATE provider_connections SET last_checked_at=COALESCE(last_checked_at,?) WHERE id=?').run(now,`${actualProviderId}:local`);
    }).immediate();
  }
}

interface ProfileRow {id:string;project_id:string;role_key:AgentProfile['roleKey'];name:string;system_instructions:string;default_provider_id:string|null;default_policy_id:string|null;provider_key:AgentProviderId;display_name:string;adapter_version:string;capabilities_json:string}
interface WorkItemRow {id:string;project_id:string;display_key:string;title:string;summary:string;status:string;parent_id:string|null;created_revision:number;updated_revision:number;created_at:string;updated_at:string;work_type:WorkItem['workType'];work_priority:WorkItem['priority'];scope_notes:string|null;acceptance_criteria_json:string;recommended_profile_role:WorkItem['recommendedProfileRole']}
interface ExecutionRow {id:string;project_id:string;work_item_id:string|null;profile_id:string;provider_id:string;session_id:string|null;context_snapshot_id:string|null;status:ExecutionStatus;model_used:string|null;initial_commit:string;final_commit:string|null;branch_or_worktree:string|null;test_summary_json:string|null;result_summary:string|null;started_at:string|null;completed_at:string|null}
interface EventRow {id:string;sequence_no:number;created_at:string;payload_json:string}
function mapProfile(row:ProfileRow):AgentProfile {return {id:row.id,projectId:row.project_id,roleKey:row.role_key,name:row.name,systemInstructions:row.system_instructions,defaultProviderId:row.default_provider_id,defaultPolicyId:row.default_policy_id};}
function mapProvider(row:ProfileRow):AgentProvider {let capabilities:AgentProvider['capabilities']=CODEX_CAPABILITIES;try{capabilities=JSON.parse(row.capabilities_json) as AgentProvider['capabilities'];}catch{}return {id:row.default_provider_id??'provider:codex',providerKey:row.provider_key,displayName:row.display_name,adapterVersion:row.adapter_version,capabilities};}
function mapExecution(row:ExecutionRow):AgentExecution {let testSummary:unknown|null=null;try{testSummary=row.test_summary_json?JSON.parse(row.test_summary_json):null;}catch{}return {id:row.id,projectId:row.project_id,workItemId:row.work_item_id,profileId:row.profile_id,providerId:row.provider_id,sessionId:row.session_id,contextSnapshotId:row.context_snapshot_id,status:row.status,modelUsed:row.model_used,initialCommit:row.initial_commit,finalCommit:row.final_commit,branchOrWorktree:row.branch_or_worktree,testSummary,resultSummary:row.result_summary,startedAt:row.started_at,completedAt:row.completed_at};}
function parseCriteria(json:string):AcceptanceCriterion[] {try{const value=JSON.parse(json) as unknown;if(!Array.isArray(value))return[];return value.flatMap((item,index)=>typeof item==='string'?[{id:String(index+1),description:item,verified:false}]:item&&typeof item==='object'&&typeof (item as {description?:unknown}).description==='string'?[{id:String((item as {id?:unknown}).id??index+1),description:(item as {description:string}).description,verified:Boolean((item as {verified?:unknown}).verified)}]:[]);}catch{return[];}}
