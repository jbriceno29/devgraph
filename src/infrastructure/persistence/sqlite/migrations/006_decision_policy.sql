-- Decisions (Stage 3): which plan changes proposed by agents are applied on their own. NULL means the defaults.
ALTER TABLE autonomy_policies ADD COLUMN decision_policy_json TEXT;
