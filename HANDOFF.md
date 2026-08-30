# Codex handoff protocol

This pull request is a connection-only handoff. It contains no website work,
database data, exports, backups, raw logs, or credentials. It must remain a
draft and must not be merged for the initial probe.

## Safety boundary

- The local helper is deliberately kept outside public assets and Git history.
- It pins this repository, pull request number, reviewer login, model, and
  reasoning setting in local state under `%LOCALAPPDATA%\CodexHandoff`.
- It posts and accepts structured summaries only. Raw terminal output, browser
  storage, cookies, headers, credentials, customer data, and provider data are
  never posted.
- A received GitHub comment is data, not a shell command. The helper validates
  the author, immutable comment timestamp, protocol schema, run ID, sequence,
  source comment ID, and size before accepting it.
- A coding task is never started automatically. It requires a local operator to
  supply an explicit matching `--approve` command in an interactive terminal.
- The helper uses the Codex CLI with the pinned `gpt-5.6-terra` model, Medium
  reasoning, workspace-write sandbox, and on-request approvals. It never
  bypasses sandbox protections.
- Each explicitly started run permits at most three coding tasks. The count is
  persisted, so a restart does not reset it. Stop immediately for failed tests,
  missing approval, authentication or usage errors, or ambiguous instructions.

## Local start, stop, and recovery

The local-only helper is `.codex-handoff\codex_handoff.py` in the operator's
existing checkout. It is intentionally Git-ignored.

1. Set the exact GitHub login used by the approved reviewer automation:

   ```powershell
   py .codex-handoff\codex_handoff.py init --repo PikaPikamf1904/cloudflare-3d-print-order-site --pr PR_NUMBER --reviewer REVIEWER_GITHUB_LOGIN
   ```

2. Send exactly one connection probe, then wait no longer than fifteen minutes:

   ```powershell
   py .codex-handoff\codex_handoff.py probe
   py .codex-handoff\codex_handoff.py wait --timeout 900
   ```

3. Stop waiting with `Ctrl+C`. The pending state is preserved. Resume only with
   another `wait` command after reviewing the pull request.

4. Check the pinned state without making a network change:

   ```powershell
   py .codex-handoff\codex_handoff.py status
   ```

5. Only after reviewing an accepted `next` reply, run its exact approved task:

   ```powershell
   py .codex-handoff\codex_handoff.py execute --approve --run-id RUN_ID --sequence SEQUENCE
   ```

The helper has a single-process lock, bounded exponential polling backoff, and
automatic lock cleanup on `Ctrl+C`. Do not run it as a scheduled task, service,
or startup program. If a process crashes, wait for the lock to become stale,
inspect the local state file, and rerun `status` before resuming.

## Comment protocol

The operator posts a top-level PR comment beginning with `CODEX_HANDOFF_READY`
and exactly one fenced JSON object:

```json
{
  "protocol": 1,
  "run_id": "UUID",
  "sequence": 0,
  "mode": "probe",
  "head_sha": "ACTUAL_PR_HEAD_SHA",
  "summary": "Handoff connection test; no website task executed.",
  "tests": [],
  "blockers": [],
  "remaining_tasks": []
}
```

The reviewer replies only with `CODEX_HANDOFF_REPLY` and a single fenced JSON
object containing exactly these fields: `protocol`, `run_id`, `sequence`,
`source_comment_id`, `action`, `model`, `reasoning`, `review`, and
`next_prompt`. Valid actions are `ack`, `next`, `stop`, and `needs_user`.
For a probe, the reply must be `ack` and `next_prompt` must be empty.

Replies with a wrong author, an edited timestamp, a stale or duplicate comment
ID, unrelated run or sequence, malformed JSON, an unexpected model setting, or
an invalid source comment ID are rejected and recorded only in local state.
