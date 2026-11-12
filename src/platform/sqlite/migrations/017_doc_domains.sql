-- Plan C1: documentación en línea para los agentes. Encendida por defecto: los dominios salen del stack del proyecto y
-- doc_domains_json guarda los que añade el usuario (solo nombres de dominio; la app los valida al guardarlos).
ALTER TABLE projects ADD COLUMN docs_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN doc_domains_json TEXT NOT NULL DEFAULT '[]';
