-- Tope de turnos del motor por ejecución. NULL o 0 = sin límite.
ALTER TABLE autonomy_policies ADD COLUMN max_turns INTEGER;
