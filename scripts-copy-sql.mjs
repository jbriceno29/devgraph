import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
const source='src/infrastructure/persistence/sqlite/migrations',target='dist/main/infrastructure/persistence/sqlite/migrations';
mkdirSync(target,{recursive:true});
for(const file of readdirSync(source).filter(name=>name.endsWith('.sql')))copyFileSync(`${source}/${file}`,`${target}/${file}`);
