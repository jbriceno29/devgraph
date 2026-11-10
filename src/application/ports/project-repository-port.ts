import type { Project, ProjectProps } from '../../domain/projects/project.js';
export interface CreateProjectRecord { project:ProjectProps; rootEntityId:string; rootCreatedAt?:string }
export interface ProjectRepositoryPort { createWithProjectRoot(input:CreateProjectRecord):Project; findById(id:string):Project|null; listAll():Project[] }
