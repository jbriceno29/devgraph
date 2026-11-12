-- Plan REP, R2: la línea base de verificación del proyecto (las comprobaciones corridas una vez sobre la rama base, y los
-- fallos que el usuario aceptó como conocidos). JSON; NULL mientras no se haya corrido.
ALTER TABLE projects ADD COLUMN verification_baseline_json TEXT;
