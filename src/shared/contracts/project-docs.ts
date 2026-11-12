/** Plan C1: documentation the agents may read, for Ajustes › Documentación en línea. */
export interface ProjectDocsDto {
  enabled: boolean;
  /** What every run gets when enabled: base, stack and the user's own domains. */
  domains: string[];
  /** Derived by the app from the project's stack (not editable). */
  stackDomains: string[];
  /** Added by the user. */
  extraDomains: string[];
}

export interface ProjectDocsInput {
  enabled: boolean;
  extraDomains: string[];
}

export interface ProjectDocsChannels {
  'project:docs': (projectId: string) => Promise<ProjectDocsDto>;
  'project:set_docs': (projectId: string, input: ProjectDocsInput) => Promise<ProjectDocsDto>;
}

/** Optional so existing fakes stay valid; the Tauri client implements them. */
export interface ProjectDocsCommands {
  getProjectDocs?(projectId: string): Promise<ProjectDocsDto>;
  setProjectDocs?(projectId: string, input: ProjectDocsInput): Promise<ProjectDocsDto>;
}
