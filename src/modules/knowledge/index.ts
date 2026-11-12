/** Public API of the module: what other modules may import (CLAUDE.md, rule 2). */
export * from './application/ports/knowledge-graph-repository-port.js';
export * from './domain/change-set.js';
export * from './domain/decision-status.js';
export * from './domain/graph-topology-service.js';
export * from './domain/knowledge-entity.js';
export * from './domain/work-items.js';
export * from './infrastructure/sqlite-knowledge-graph-repository.js';
