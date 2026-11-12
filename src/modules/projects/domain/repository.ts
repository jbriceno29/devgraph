export interface Repository {
  id: string;
  projectId: string;
  name: string;
  localPath: string;
  gitProvider: string;
  defaultBranch: string;
  headCommit: string | null;
  isPrimary: boolean;
  createdAt: string;
}
export interface ProjectRule {
  id: string;
  projectId: string;
  text: string;
  createdAt: string;
}
