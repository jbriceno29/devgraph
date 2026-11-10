import type { ArtifactManagementService } from '../../application/artifacts/artifact-management-service.js';
import type { AtomicMarkdownFilePort } from '../../application/ports/artifact-management-port.js';

export class ArtifactWatcherService {
  private stopWatching:(()=>void)|null=null;
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  constructor(private readonly projectId:string,private readonly repositoryRoot:string,private readonly files:AtomicMarkdownFilePort,private readonly management:ArtifactManagementService){}

  async start():Promise<void> {
    if(this.stopWatching) return;
    await this.files.ensureDocsDirectory(this.repositoryRoot);
    this.stopWatching=this.files.watchDocs(this.repositoryRoot,relativePath=>this.schedule(relativePath));
    this.management.reconcileExternalChange(this.projectId,null);
  }

  stop():void {
    this.stopWatching?.();this.stopWatching=null;
    for(const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(relativePath:string|null):void {
    const key=relativePath??'*';
    const old=this.timers.get(key);if(old)clearTimeout(old);
    this.timers.set(key,setTimeout(()=>{
      this.timers.delete(key);
      this.management.reconcileExternalChange(this.projectId,relativePath);
    },45));
  }
}
