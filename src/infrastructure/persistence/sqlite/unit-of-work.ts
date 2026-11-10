import type { UnitOfWorkPort } from '../../../application/ports/unit-of-work-port.js';
import type { SqliteDatabase } from './database.js';
export class SqliteUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly db: SqliteDatabase) {}
  execute<T>(work: () => T): T { return this.db.transaction(work).immediate(); }
}
