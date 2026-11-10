# Claude Code CLI fixtures

Real output of `claude -p` captured on 2026-11-10 with Claude Code **2.1.318**, model `claude-haiku-5-5`,
authenticated with a Claude subscription (`apiKeySource: "none"` in `system/init`).

All runs used a clean environment (`env -i HOME PATH LANG USER`), a throwaway Git repository as `cwd`,
the prompt on stdin, and these common flags:

```
claude -p --output-format stream-json --verbose --model haiku --strict-mcp-config --no-session-persistence
```

Sanitized before committing: repository paths → `/workspace/repo`, home → `/home/user`, OS user → `user`,
local setup lists in `system/init` (`mcp_servers`, `plugins`, `skills`, `slash_commands`, `agents`,
`memory_paths`, …) emptied, `credential_expires_at` nulled, rate-limit utilization set to `0.1`.

| File | Extra flags | What it shows |
| :--- | :--- | :--- |
| `edit-file.stream.jsonl` | `--permission-mode dontAsk --permission-prompts none --allowedTools Read "Write(src/**)" "Edit(src/**)"` | Successful `Write` to `src/hello.ts`; a `Bash` attempt denied first (`system/permission_denied`). |
| `denied-tools.stream.jsonl` | same | `Write` to `README.md` (root) and two write-like `Bash` commands denied; `Write` to `src/ok.ts` allowed; **`ls -la` auto-approved** (`reason_type: "subcommandResults"`). Denials listed in `result.permission_denials` while `subtype` is still `success`. |
| `outside-read-denied.stream.jsonl` | `--allowedTools "Write(src/**)" "Edit(src/**)"` (no Read, no Bash) | `cat ../file` and `Read ../file` outside `cwd` are both rejected. |
| `bash-disallowed.stream.jsonl` | same + `--disallowedTools Bash` | `Bash` is unavailable; it does not run at all. |
| `structured-output.json` | `--output-format json --tools "" --json-schema '<schema>'` | A plain JSON schema (optional properties, no "all required + nullable" trick) works; the object is in `structured_output`. |
| `cancel-sigint.stream.jsonl` | `--tools "" --include-partial-messages`, SIGINT after 7 s | Exit code **0**; ends with `result` `subtype: "error_during_execution"`, `is_error: true`, `terminal_reason: "aborted_streaming"`. |
| `cancel-sigterm.stream.jsonl` | same, SIGTERM after 7 s (first 12 lines only) | Exit code **143**; **no** `result` message is emitted. |

Not captured: a usage-limit error (it cannot be provoked on demand). Every run emits a
`rate_limit_event` with `rate_limit_info.status`, `rateLimitType` and per-window `utilization`/`resetsAt`,
which is the signal to surface before the limit is hit.
