import type { ProjectRepositoryPort, CreateProjectRecord } from './ports/project-repository-port.js';
import type { UnitOfWorkPort } from './ports/unit-of-work-port.js';
import type { Project } from '../domain/project.js';
export class CreateProjectUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly projects: ProjectRepositoryPort,
  ) {}
  execute(input: CreateProjectRecord): Project {
    return this.unitOfWork.execute(() => this.projects.createWithProjectRoot(input));
  }
}
