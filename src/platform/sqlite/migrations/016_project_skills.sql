-- Plan S4: si las tareas de interfaz del proyecto reciben las skills incluidas en la app. Apagado por defecto: en la medición
-- notas-spa (2026-11-12) Impeccable multiplicó por 3–4,5 el costo de cada tarea de interfaz sin cambiar las pruebas ocultas.
ALTER TABLE projects ADD COLUMN skills_enabled INTEGER NOT NULL DEFAULT 0;
