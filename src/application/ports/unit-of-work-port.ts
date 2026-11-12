export interface UnitOfWorkPort {
  execute<T>(work: () => T): T;
}
