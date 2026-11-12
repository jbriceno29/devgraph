# Skills incluidas en la app

Plan S4 (`docs/PLAN_STACKS_REGLAS_Y_SKILLS.md`). Cada carpeta es una skill que la app copia en el worktree de las ejecuciones que la necesitan (`.claude/skills/<id>/`). Nada se descarga al instalar ni al ejecutar.

- `skill.json`: origen y commit fijado, licencia, hash del contenido (`sha256` de `content/`, calculado por `contentHash` en `src/infrastructure/skills/skill-bundle.ts`), a qué tareas aplica y la nota que recibe el agente.
- `content/`: lo que se copia tal cual. Si su hash no coincide con el del manifiesto, la app no la usa.
- Licencia y avisos del autor original junto a cada skill.

Para actualizar una skill: copiar el contenido nuevo desde el commit elegido, revisarlo entero (una skill tiene los mismos permisos que el agente), recalcular el hash y actualizar `commit` y `sha256`.

| Skill | Origen | Licencia |
| :--- | :--- | :--- |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ `b4bff16` | Apache-2.0 (`skills/impeccable/LICENSE`, `NOTICE.md`) |
