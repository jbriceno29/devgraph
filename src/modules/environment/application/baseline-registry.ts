/** Baselines running in this process, with the commands they run (the result is stored when they finish). */
export class BaselineRegistry {
  private readonly running = new Map<string, string[]>();
  get(projectId: string): string[] | undefined {
    return this.running.get(projectId);
  }
  start(projectId: string, commands: string[]): void {
    this.running.set(projectId, commands);
  }
  finish(projectId: string): void {
    this.running.delete(projectId);
  }
}
