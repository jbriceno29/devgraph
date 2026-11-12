-- Plan S5: modelo que revisa cada ejecución contra sus criterios antes de que el piloto la acepte (null: sin revisión).
ALTER TABLE feature_autonomy ADD COLUMN review_model TEXT;
