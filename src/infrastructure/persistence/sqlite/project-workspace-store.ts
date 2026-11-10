import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateProjectInput, ProjectSummaryDto } from '../../../shared/contracts/ipc-contracts.js';
import { CreateProjectUseCase } from '../../../application/projects/create-project.js';
import { SqliteProjectRepository } from '../repositories/sqlite-project-repository.js';
import { SqliteKnowledgeGraphRepository } from '../repositories/sqlite-knowledge-graph-repository.js';
import { SqliteArtifactRepository } from '../repositories/sqlite-artifact-repository.js';
import { SqliteRepositoryLocationRepository } from '../repositories/sqlite-repository-location-repository.js';
import { openDatabase, closeDatabase, type SqliteDatabase } from './database.js';
import { SqliteUnitOfWork } from './unit-of-work.js';
export interface ProjectWorkspace { id:string; database:SqliteDatabase; projects:SqliteProjectRepository; graph:SqliteKnowledgeGraphRepository; artifacts:SqliteArtifactRepository; repositories:SqliteRepositoryLocationRepository }
export class ProjectWorkspaceStore {
  private readonly open=new Map<string,ProjectWorkspace>();
  constructor(private readonly rootDirectory:string){}
  listProjects():ProjectSummaryDto[] {
    const projectsDirectory=join(this.rootDirectory,'projects'); if(!existsSync(projectsDirectory))return [];
    return readdirSync(projectsDirectory,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-f0-9-]{36}$/i.test(entry.name)).flatMap(entry=>{
      const dbPath=join(projectsDirectory,entry.name,'workspace.sqlite'); if(!existsSync(dbPath))return [];
      const existing=this.open.get(entry.name); const db=existing?.database??openDatabase({filename:dbPath,initialize:false});
      const project=new SqliteProjectRepository(db).findById(entry.name); if(!existing)closeDatabase(db);
      return project?[toSummary(project)]:[];
    });
  }
  createProject(input:CreateProjectInput):ProjectWorkspace {
    const id=randomUUID(),directory=join(this.rootDirectory,'projects',id); mkdirSync(directory,{recursive:true});
    const database=openDatabase({filename:join(directory,'workspace.sqlite')});
    const projects=new SqliteProjectRepository(database),graph=new SqliteKnowledgeGraphRepository(database),artifacts=new SqliteArtifactRepository(database),repositories=new SqliteRepositoryLocationRepository(database);
    const now=new Date().toISOString();
    try {
      new CreateProjectUseCase(new SqliteUnitOfWork(database),projects).execute({project:{id,name:input.name,slug:input.slug,description:input.description??null,objectives:input.objectives??[],techStack:input.techStack??{},rules:input.rules??[],createdAt:now,updatedAt:now},rootEntityId:randomUUID()});
      const workspace={id,database,projects,graph,artifacts,repositories};this.open.set(id,workspace);return workspace;
    } catch(error) { closeDatabase(database);rmSync(directory,{recursive:true,force:true});throw error; }
  }
  openProject(id:string):ProjectWorkspace {
    if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid project id.');
    const existing=this.open.get(id);if(existing)return existing;
    const dbPath=join(this.rootDirectory,'projects',id,'workspace.sqlite');if(!existsSync(dbPath))throw new Error(`Project not found: ${id}`);
    const database=openDatabase({filename:dbPath,initialize:false});const projects=new SqliteProjectRepository(database);
    if(!projects.findById(id)){closeDatabase(database);throw new Error(`Project database is missing project ${id}.`);}
    const workspace={id,database,projects,graph:new SqliteKnowledgeGraphRepository(database),artifacts:new SqliteArtifactRepository(database),repositories:new SqliteRepositoryLocationRepository(database)};this.open.set(id,workspace);return workspace;
  }
  closeAll():void {for(const workspace of this.open.values())closeDatabase(workspace.database);this.open.clear();}
}
const toSummary=(p:import('../../../domain/projects/project.js').Project):ProjectSummaryDto=>({id:p.props.id,name:p.props.name,slug:p.props.slug,description:p.props.description??null,currentRevision:p.currentRevision,createdAt:p.props.createdAt,updatedAt:p.props.updatedAt});
