import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
const source='src/infrastructure/persistence/sqlite/migrations',target='dist/main/infrastructure/persistence/sqlite/migrations';
mkdirSync(target,{recursive:true});
for(const file of readdirSync(source).filter(name=>name.endsWith('.sql')))copyFileSync(`${source}/${file}`,`${target}/${file}`);
// Plan S4: the skills that ship with the app sit next to the core (dist/main/skills, resources/core/skills once packaged).
cpSync('skills','dist/main/skills',{recursive:true});
