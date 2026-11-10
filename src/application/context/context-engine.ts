import type { ContextRepositoryPort,ContextFilePort } from '../ports/context-engine-port.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import { ContextResolver } from './context-resolver.js';
import { GraphTraversal } from './graph-traversal.js';
import { HybridRetrieval } from './hybrid-retrieval.js';
import { ContextRanking } from './context-ranking.js';
import { ContextPackager,type ContextPackage } from './context-packager.js';

export interface PreviewContextRequest {projectId:string;focusEntityId:string;maxAllowedTokens?:number;query?:string;maxHops?:number;recentNotes?:string[];executionId?:string}
export class ContextEngine {
 constructor(private readonly repository:ContextRepositoryPort,private readonly files:ContextFilePort){}
 async preview(input:PreviewContextRequest):Promise<ContextPackage>{const maxAllowedTokens=input.maxAllowedTokens??32_000;if(!Number.isInteger(maxAllowedTokens)||maxAllowedTokens<1||maxAllowedTokens>1_000_000)throw new Error('El presupuesto de tokens debe ser un entero entre 1 y 1,000,000.');const context=await new ContextResolver(this.repository,this.files).resolve(input);new GraphTraversal(this.repository).expand(context);await new HybridRetrieval(this.repository,this.files).enrich(context);const ranked=new ContextRanking().rank(context.candidates,context.excluded,maxAllowedTokens);return new ContextPackager(this.repository).package(context,ranked,maxAllowedTokens);}
 getSnapshot(snapshotId:string):ContextSnapshot{const snapshot=this.repository.findSnapshot(snapshotId);if(!snapshot)throw new Error('ContextSnapshot no encontrado.');return snapshot;}
}
