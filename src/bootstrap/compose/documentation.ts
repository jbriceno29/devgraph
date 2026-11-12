import { SqliteProjectEnvironmentRepository } from '../../modules/environment/infrastructure/sqlite-project-environment.js';
import {
  BASE_DOC_DOMAINS,
  docDomainsFor,
  parseExtraDocDomains,
  stackDocDomains,
} from '../../modules/projects/domain/doc-domains.js';
import type { ProjectDocsDto } from '../../shared/contracts/project-docs.js';
import type { Container } from '../container.js';

const parseList = (json: string | undefined): string[] => {
  try {
    const value = JSON.parse(json || '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};
const parseStack = (json: string | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(json || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Plan C1: the documentation domains each project's runs may read, and the setting in Ajustes. */
export function documentationServices(c: Container) {
  const rows = (projectId: string) => new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database);
  const docsView = (projectId: string): ProjectDocsDto => {
    const row = rows(projectId).docs(projectId);
    const techStack = parseStack(row?.techStackJson),
      extraDomains = parseList(row?.extraDomainsJson),
      enabled = row?.enabled ?? true;
    return {
      enabled,
      domains: docDomainsFor({ enabled, techStack, extra: extraDomains }),
      stackDomains: [...new Set([...BASE_DOC_DOMAINS, ...stackDocDomains(techStack)])],
      extraDomains,
    };
  };
  return {
    docsView,
    docDomains: (projectId: string) => docsView(projectId).domains,
    setDocs: (projectId: string, raw: unknown): ProjectDocsDto => {
      const input = (raw ?? {}) as { enabled?: unknown; extraDomains?: unknown };
      if (typeof input.enabled !== 'boolean') throw new Error('Indica si los agentes pueden leer documentación.');
      const parsed = parseExtraDocDomains(input.extraDomains ?? []);
      if ('error' in parsed) throw new Error(parsed.error);
      rows(projectId).setDocs(projectId, input.enabled, parsed.domains);
      return docsView(projectId);
    },
    close: () => undefined,
  };
}
