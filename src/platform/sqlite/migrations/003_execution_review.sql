-- Stage 1 (close the loop): review outcome of each execution and the link between a revision and the run it adjusts.
ALTER TABLE agent_executions ADD COLUMN execution_branch TEXT;
ALTER TABLE agent_executions ADD COLUMN revision_of TEXT REFERENCES agent_executions(id) ON DELETE SET NULL;
ALTER TABLE agent_executions ADD COLUMN review_status TEXT CHECK(review_status IN ('ACCEPTED', 'CHANGES_REQUESTED', 'MERGE_CONFLICT'));
ALTER TABLE agent_executions ADD COLUMN review_note TEXT;
ALTER TABLE agent_executions ADD COLUMN merged_commit TEXT;
ALTER TABLE agent_executions ADD COLUMN reviewed_at TEXT;
