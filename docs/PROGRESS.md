# Project Progress

Last updated: 2026-11-10

This file records the implementation handoff. The specifications in `DOMAIN.md`,
`ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md` remain authoritative.

## Current status

- Stages 1–5: completed in prior work; see `IMPLEMENTATION_PLAN.md` for scope.
- Stage 6, Agent Integration Layer: implemented and verified in commit `9d3d859`.
- Stage 7, Execution Governance, Git Worktrees & Sandbox Audit: implemented and
  verified in the current working tree.
- Next: Stage 8, Feedback Loop, Traceability & End-to-End MVP Verification.

Stage 6 provides the Codex CLI adapter, `AgentOrchestrator`, execution/profile
queries and commands through Tauri IPC, an Agents monitoring view, SQLite event
persistence, and per-execution `events.jsonl` logs. Codex was smoke-tested
through the application adapter in a temporary directory: it created the
requested file and streamed session, tool, and completion events.

## Verification for Stage 6

- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — 14 files, 38 tests passed.
- `npm run build` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — passed, 1 test.
- Application-adapter Codex smoke test — passed; temporary workspace removed.

## Stage 7 implementation and verification

- Every execution creates a branch and a worktree at
  `projects/<project-id>/worktrees/<execution-id>/`; the configured checkout
  remains untouched.
- The execution validator records `changes.patch`, per-file diff rows and
  `test-output.log`, audits writable/read-only/denied paths, includes ignored
  files in the denied-path audit, and reverts unauthorized paths inside the
  worktree.
- Verification commands run only when explicitly listed in the assigned
  `AutonomyPolicy.allowedCommands`; the default policy does not run repository
  scripts. Codex CLI continues to report `supportsApprovals: false`; the UI and
  orchestrator provide the approval pause/decision flow for adapters that
  declare and implement interactive approvals.
- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — 15 files, 43 tests passed.
- `npm run build` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — passed, 1 test.
- End-to-end smoke through the real Codex adapter — passed; it wrote the
  requested file in its isolated worktree and left the configured checkout
  untouched. The temporary project and worktree were removed after the check.

## Handoff notes

- Read `DOMAIN.md`, `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md` before
  changing architecture or persistence.
- Stage 7 leaves execution worktrees available for review; merge and cleanup
  workflows are part of Stage 8 or later product work.
- The renderer communicates through typed Tauri IPC contracts; it must not
  access SQLite or the filesystem directly.

## Where runtime execution progress is stored

- Execution state, session references, and agent events are persisted in the
  project's SQLite database (`agent_executions`, `agent_sessions`, and
  `agent_events`).
- The append-only event stream is also written to
  `projects/<project-id>/executions/<execution-id>/events.jsonl` beneath the
  configured workspace-local directory.
- The sealed `ContextSnapshot` is persisted by the context subsystem and linked
  from each execution.

These runtime records track agent runs. They do not replace this file, which
tracks development-stage progress and the next implementation handoff.
