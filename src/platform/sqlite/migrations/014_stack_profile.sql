-- Plan S1/S2: el perfil de stack del catálogo que sigue el proyecto (null si no sigue ninguno, por ejemplo un proyecto brownfield) y
-- los paquetes que el usuario aprobó además de los del perfil (la app los instala sin volver a preguntar).
ALTER TABLE projects ADD COLUMN stack_profile_id TEXT;
ALTER TABLE projects ADD COLUMN approved_dependencies_json TEXT NOT NULL DEFAULT '[]';
