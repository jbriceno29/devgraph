import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CreateProjectUseCase } from '../../src/application/projects/create-project.js';
import { ArtifactManagementService } from '../../src/application/artifacts/artifact-management-service.js';
import { AtomicMarkdownFileStore } from '../../src/infrastructure/filesystem/atomic-markdown-file-store.js';
import { ArtifactWatcherService } from '../../src/infrastructure/filesystem/artifact-watcher-service.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/persistence/repositories/sqlite-artifact-repository.js';
import { SqliteKnowledgeGraphRepository } from '../../src/infrastructure/persistence/repositories/sqlite-knowledge-graph-repository.js';
import { SqliteProjectRepository } from '../../src/infrastructure/persistence/repositories/sqlite-project-repository.js';
import { SqliteRepositoryLocationRepository } from '../../src/infrastructure/persistence/repositories/sqlite-repository-location-repository.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import { SqliteUnitOfWork } from '../../src/infrastructure/persistence/sqlite/unit-of-work.js';

describe('Artifact management and Markdown synchronization',()=>{
 const temporaryDirectories:string[]=[];
 afterEach(async()=>{await Promise.all(temporaryDirectories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

 it('creates linked Markdown documents atomically and refreshes FTS when an external editor changes one',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'graphdev2-artifacts-'));temporaryDirectories.push(temp);
  const repositoryPath=join(temp,'repository');await mkdir(repositoryPath);execFileSync('git',['init','--quiet',repositoryPath]);
  const db=openDatabase({filename:':memory:'});
  let watcher:ArtifactWatcherService|undefined;
  try {
   const projects=new SqliteProjectRepository(db),graph=new SqliteKnowledgeGraphRepository(db),artifacts=new SqliteArtifactRepository(db),repositories=new SqliteRepositoryLocationRepository(db);
   const projectId='project-artifacts';
   new CreateProjectUseCase(new SqliteUnitOfWork(db),projects).execute({project:{id:projectId,name:'Artifact Test',slug:'artifact-test',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},rootEntityId:'project-root'});
   const events:Array<{documentId:string;syncStatus:string}>=[];
   const service=new ArtifactManagementService(projects,graph,artifacts,repositories,new AtomicMarkdownFileStore(),event=>events.push(event));
   await service.configureRepository(projectId,repositoryPath);
   const created=await service.create({projectId,entityType:'ARTIFACT',title:'Search specification',artifactType:'SPEC',targetEntityId:'project-root'});
   expect(await readFile(join(repositoryPath,created.document.relativePath),'utf8')).toContain('# Search specification');
   expect(graph.listRelationships(projectId)).toEqual([expect.objectContaining({sourceId:'project-root',targetId:created.document.id,edgeType:'DOCUMENTED_BY'})]);
   expect(db.prepare('SELECT body_content FROM fts_knowledge_index WHERE entity_id=?').get(created.document.id)).toEqual({body_content:created.content});
   expect(created.document.syncStatus).toBe('SYNCED');

   watcher=new ArtifactWatcherService(projectId,repositoryPath,new AtomicMarkdownFileStore(),service);
   await watcher.start();
   const changed=created.content+'\nExternal revision searchabletoken.\n';
   const detected=new Promise<void>((resolve,reject)=>{
    let poll:ReturnType<typeof setInterval>;
    const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('The Markdown watcher did not report the change within 900ms.'));},900);
    poll=setInterval(()=>{
     if(events.some(event=>event.documentId===created.document.id&&event.syncStatus==='DRIFTED')){clearTimeout(timeout);clearInterval(poll);resolve();}
    },10);
   });
   const start=performance.now();await writeFile(join(repositoryPath,created.document.relativePath),changed);await detected;
   expect(performance.now()-start).toBeLessThan(1000);
   const drifted=artifacts.findDocumentById(created.document.id)!;
   expect(drifted.syncStatus).toBe('DRIFTED');
   expect(db.prepare('SELECT body_content FROM fts_knowledge_index WHERE entity_id=?').get(created.document.id)).toEqual({body_content:changed});
   expect(db.prepare(`SELECT count(*) AS count FROM fts_knowledge_index WHERE fts_knowledge_index MATCH 'searchabletoken'`).get()).toEqual({count:1});

   const saved=await service.save(created.document.id,drifted.contentHash,changed+'\nSaved from workspace.\n');
   expect(saved.document.syncStatus).toBe('SYNCED');
  } finally {watcher?.stop();closeDatabase(db);}
 });

 it('creates ADR records with AFFECTS links and rejects paths that escape the repository',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'graphdev2-adr-'));temporaryDirectories.push(temp);
  const repositoryPath=join(temp,'repository');await mkdir(repositoryPath);execFileSync('git',['init','--quiet',repositoryPath]);
  const db=openDatabase({filename:':memory:'});
  try {
   const projects=new SqliteProjectRepository(db),graph=new SqliteKnowledgeGraphRepository(db),artifacts=new SqliteArtifactRepository(db),repositories=new SqliteRepositoryLocationRepository(db);
   new CreateProjectUseCase(new SqliteUnitOfWork(db),projects).execute({project:{id:'adr-project',name:'ADR Test',slug:'adr-test',createdAt:'now',updatedAt:'now'},rootEntityId:'adr-root'});
   const files=new AtomicMarkdownFileStore();const service=new ArtifactManagementService(projects,graph,artifacts,repositories,files);
   await service.configureRepository('adr-project',repositoryPath);
   const adr=await service.create({projectId:'adr-project',entityType:'DECISION_RECORD',title:'Use local storage',targetEntityId:'adr-root'});
   expect(adr.document.relativePath).toBe('docs/architecture/ADR/ADR-001.md');
   expect(graph.listRelationships('adr-project')).toEqual([expect.objectContaining({sourceId:adr.document.id,targetId:'adr-root',edgeType:'AFFECTS'})]);
   await expect(files.writeMarkdownAtomically(repositoryPath,'../../outside.md','unsafe')).rejects.toThrow(/salir del repositorio|permanecer dentro/i);
  } finally {closeDatabase(db);}
 });
});
