import { text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { SqliteDatabase } from '../../platform/sqlite/database.js';
import type { InceptionActivityDto } from '../../shared/contracts/inception-view.js';
import { ActivityService } from './application/activity-service.js';
import { SqliteActivityRepository } from './infrastructure/sqlite-activity-repository.js';

export interface ActivityIpcDeps {
  store: { openProject(id: string): { database: SqliteDatabase } };
  inception(projectId: string): { activity(projectId: string): InceptionActivityDto | null };
}

/** The project's activity inbox, derived without AI. */
export function activityHandlers(d: ActivityIpcDeps): IpcHandlers {
  return {
    'activity:list': ([id, limit]) =>
      new ActivityService(new SqliteActivityRepository(d.store.openProject(text(id)).database), projectId =>
        d.inception(projectId).activity(projectId),
      ).list(text(id), typeof limit === 'number' ? limit : undefined),
  };
}
