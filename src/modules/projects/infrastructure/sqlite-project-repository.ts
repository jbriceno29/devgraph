import { Project, type ProjectProps } from '../domain/project.js';
import type { ProjectRepositoryPort, CreateProjectRecord } from '../application/ports/project-repository-port.js';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
export class SqliteProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}
  createWithProjectRoot({ project, rootEntityId, rootCreatedAt = project.createdAt }: CreateProjectRecord): Project {
    const aggregate = new Project(project);
    this.db
      .prepare(
        `INSERT INTO projects (id,name,slug,description,objectives_json,tech_stack_json,rules_json,current_revision,created_at,updated_at) VALUES (@id,@name,@slug,@description,@objectives_json,@tech_stack_json,@rules_json,1,@created_at,@updated_at)`,
      )
      .run({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description ?? null,
        objectives_json: JSON.stringify(project.objectives ?? []),
        tech_stack_json: JSON.stringify(project.techStack ?? {}),
        rules_json: JSON.stringify(project.rules ?? []),
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
    this.db
      .prepare(
        `INSERT INTO knowledge_entities (id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES (?,?, 'PROJECT_ROOT','PROJ-01',?,'','ACTIVE',NULL,1,1,?,?)`,
      )
      .run(rootEntityId, project.id, project.name, rootCreatedAt, rootCreatedAt);
    return aggregate;
  }
  listAll(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
    return rows.map(row => this.mapProject(row));
  }
  findById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? this.mapProject(row) : null;
  }
  private mapProject(row: ProjectRow): Project {
    return new Project({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      objectives: JSON.parse(row.objectives_json) as string[],
      outOfScope: row.out_of_scope_json ? (JSON.parse(row.out_of_scope_json) as string[]) : [],
      techStack: JSON.parse(row.tech_stack_json) as Record<string, unknown>,
      rules: JSON.parse(row.rules_json) as string[],
      currentRevision: row.current_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  objectives_json: string;
  tech_stack_json: string;
  rules_json: string;
  out_of_scope_json?: string;
  current_revision: number;
  created_at: string;
  updated_at: string;
}
