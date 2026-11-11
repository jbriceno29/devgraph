-- Inicio del proyecto: referencias (capturas, bocetos, documentos) que el usuario adjunta, con el tipo que les dio (VISUAL, FUNCTIONAL,
-- CONCEPTUAL) y su traducción a texto hecha por un modelo aparte. El asistente solo trabaja con ese texto; los archivos viven en el workspace.
ALTER TABLE project_inception ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]';
