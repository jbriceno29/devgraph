-- Inicio del proyecto, modo brownfield: lo que se leyó del repositorio cuando ya tenía código (manifiestos, estructura y estilos, como mucho
-- 48 KB), lo que el asistente infirió de ello con su evidencia y lo que el usuario corrigió, en un solo JSON (null en un proyecto nuevo).
ALTER TABLE project_inception ADD COLUMN repository_json TEXT NOT NULL DEFAULT 'null';
