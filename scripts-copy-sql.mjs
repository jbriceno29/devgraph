import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist/main/infrastructure/persistence/sqlite/migrations',{recursive:true});
copyFileSync('src/infrastructure/persistence/sqlite/migrations/001_initial_workspace_schema.sql','dist/main/infrastructure/persistence/sqlite/migrations/001_initial_workspace_schema.sql');
