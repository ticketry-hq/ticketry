# CODING-2684 global MCP release verification

Verification on 2026-10-10 against the installed Ticketry app in the shared,
already modified workspace. Specification:
[`CODING-2533-global-mcp-spec.md`](CODING-2533-global-mcp-spec.md).
Times below are UTC. Provider configuration and credentials are omitted.

## Changes

- README.md, CLAUDE.md and AGENTS.md describe automatic global `ticketry`
  registration for Claude and Codex, global authority with workflow gates,
  refusal of run-only controls, development/override exclusions, manual stdio
  registration, run precedence, and offline recovery.
- CLAUDE.md and AGENTS.md contain identical MCP guidance.

## Installed artifact and setup

- `/Applications/Ticketry.app`, version 0.2.0, macOS arm64. This is an unsigned
  local package, not a signed release-distribution verification.
- The previously installed hook lacked `--global` in its help. This acceptance
  reused the package built by CODING-2683 and installed with
  `replaceInstalledApp`; it did not test the stale executable.
- Installed main executable SHA-256:
  `394b736b44492317d04045e3e303be02cb3fbd76969953be450fd4d06e55c86e`.
- Installed hook SHA-256:
  `dc2e861b7a584275269f10e292e192808f7fdeac03b7e111c3ce3758a0d4e3fc`.
- Installed startup registered both providers with only the canonical command
  `/Applications/Ticketry.app/Contents/MacOS/ticketry-hook` and arguments
  `["mcp", "--data-dir", "<product-data-directory>", "--global"]`.
  No authorization secret or additional fields were registered.
- Claude Code 2.1.286. `codex --version` and the Codex TUI report 0.162.0;
  its rollout metadata reports 0.162.1. Both observations are retained rather
  than presenting a single assumed Codex version.
- Plain `claude` and `codex` were started in tmux with no injected MCP
  configuration, in `/private/tmp/coding-2684-outside`. The directory was
  checked against all 33 registered module paths and is outside every module.
- Plain Claude PID 15338 and Codex PID 15340 remained alive through the outage.
  Ticketry PID 15072 was quit through its application menu, then restarted
  as PID 17745.

## Real provider CLI matrix

### Plain Claude, global server

Session `c3f25d63-4da0-49ac-8eae-3a4a37c7f93f`:

- `list_projects` returned 10 projects at 05:01:11.114.
- `get_task_details({"id_or_key":"CODING-2684"})` returned the requested
  work item at 05:01:14.367, ID `c869f1d7-cd10-43e7-9718-049a6c1ddf60`.
- Global `terminate_current_run` was refused at 05:01:16.533:
  `{"ok":false,"error":"caller_run_unbound","reason":"authorization_missing"}`.
- After Ticketry quit, `list_projects` failed at 05:03:34.009 with Claude's
  displayed tool error `Ticketry MCP is unavailable`; the CLI kept running.
  Claude omits the numeric code and error data from its tool transcript.
- A separate invocation of the installed global hook while Ticketry was
  offline returned the exact protocol error below, supplementing the provider
  display rather than claiming that Claude exposed these fields:

  ```json
  {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"data":{"code":"service_unavailable"},"message":"Ticketry MCP is unavailable"}}
  ```

- After restart, Claude `/mcp` reported `Reconnected to ticketry`, using the
  installed hook with `--global`. In the original session and unchanged PID
  15338, `list_projects` returned 10 projects at 05:05:10.779 and
  `get_task_details` returned CODING-2684 at 05:05:11.051; both succeeded.

### Plain Codex, global server

Session `01a1242f-6fdb-7e62-acd6-26fe9e8b8748`, unchanged PID 15340:

- `list_projects` returned 10 projects at 05:01:49.002.
- `get_task_details` returned CODING-2684 at 05:01:51.307.
- Global `terminate_current_run` returned the same `caller_run_unbound` /
  `authorization_missing` refusal at 05:01:52.844.
- Offline `list_projects` at 05:03:49.411 returned
  `Mcp error: -32001: Ticketry MCP is unavailable({"code":"service_unavailable"})`;
  the same session and original PID remained alive.
- After restart, `list_projects` returned 10 projects at 05:04:35.156 and
  `get_task_details` returned CODING-2684 at 05:04:37.323. Both were successful
  in the original session; no manual reconnect was needed in this run.

### Ticketry-launched agents, run-scoped server

Ticketry launched Claude and Codex against acceptance fixture CODING-2721
(`bbb1a303c5ee427dbe06b571ac5cc7cc`) in the CODING project
(`345113f3-2578-4285-aed7-b86eb7c4fd78`). Each provider's `list_projects`
returned only that project, rather than the 10 seen by the global sessions.

- Claude run `5de60fa8aaeee63f3083c368b63332ef`, provider session
  `b6ff9455-91dc-4b37-862b-8795f35057af`: `list_tasks` filtered to the CODING
  project, Ticketry module and Review returned 36 records at 05:02:34.574.
  Every returned `project_id` was the CODING project.
- Codex run `7c69765025856c98c03d721d65c9607a`, provider session
  `01a12430-f637-7be1-92d6-e3a7ad2ba20c`: the same filtered `list_tasks`
  succeeded at 05:02:42.456. Its provider log truncates the tool output;
  visible records have only CODING project IDs and 36 distinct CODING keys.
  A complete record count is not inferred from that truncated transcript.
- Claude and Codex `terminate_current_run` receipts at 05:02:40.037 and
  05:02:45.667 respectively returned `ok:true`, `termination_requested:true`,
  the correct concrete run ID, and `terminated:false`. These receipts prove
  an accepted request, not completed termination.
- Subsequent persisted reads prove both runs have `status:"terminated"` and
  `lifecycle_state:"exited"`, with matching `ended_at` / `terminated_at`:
  Claude 05:02:41.328691 and Codex 05:02:50.993056. Both concrete run tmux
  sessions were absent afterward.

The first Claude fixture's additional all-zero project probe returned `not_found`;
it is not evidence of rejection of an existing foreign project. Codex made no
foreign-project probe in that first run. The supplemental runs below verify
the existing-project boundary with complete, bounded output.

### Supplemental bounded run-scope checks

Two further agents launched by Ticketry against the same CODING-2721 fixture
tested a known existing foreign project, Flow
(`1197d592-df15-4aa3-888f-0d59028038e2`), then their own CODING project with
the Ticketry module and `state_name:"Cancelled"` filter. Both foreign
`list_tasks` calls returned this exact denial:

```json
{"ok":false,"detail":"The caller is not authorized for that project.","code":"foreign_scope"}
```

- Claude run `a4590c22db57a33d44ef7f5d429806a0`, session
  `b64f5e54-7c16-4874-810e-9b655692d292`: foreign denial at 05:06:34.955;
  own-project success `{"result":[]}` at 05:06:37.371; accepted termination
  request at 05:06:39.592 with its correct run ID.
- Codex run `4c2b58ca749172db5e355807fb0aae77`, session
  `01a12434-ba7a-7392-94f5-d1b1a87cd3e9`: foreign denial at 05:06:54.492;
  own-project success `{"result":[]}` at 05:06:59.135; accepted termination
  request at 05:07:02.415 with its correct run ID.
- Both termination receipts report `ok:true`, `termination_requested:true`,
  `terminated:false`, `already_terminated:false`. Subsequent read-only SQLite
  queries independently confirm `status:"terminated"`,
  `lifecycle_state:"exited"`, and matching `ended_at` / `terminated_at`:
  Claude 05:06:40.483303 and Codex 05:07:03.220729. Both named tmux sessions
  are absent from the subsequent session inventory.

The empty own-project result is a successful bounded query, not evidence that
the project has no tasks. Together with the first runs' project lists and
nonempty scoped task results, these untruncated denials demonstrate that the
Ticketry-launched agents cannot use global project authority.

## Passed checks and evidence limits

- `bun run --cwd studio test:overhaul` exited 0: 253 suites / 1,028 tests,
  followed by 5 suites / 20 tests for the compiled Roadmap-off configuration.
- Scoped `git diff --check` passed; agent MCP paragraphs match byte for byte.
- Plain global calls, outage/session survival, both providers' recovery, global run-only
  refusal, and both Ticketry-launched run-scoped termination checks passed.
- Both providers also passed complete bounded own-project queries and
  `foreign_scope` denial for a known existing foreign project.
- This verifies the specification's real-CLI manual acceptance matrix. It
  does not independently re-run the registrar's complete configuration-safety
  matrix or every workflow gate. The first Codex task output retains its
  truncation limit; the supplemental checks have complete receipts.

## Cleanup

The acceptance fixture CODING-2721 is retained in `Cancelled`, preserving all
four completed run records. It was neither archived nor permanently deleted.
All four launched runs are terminal, and their tmux sessions are absent.
The two temporary plain CLI sessions were closed after recording successful
recovery. The installed Ticketry app remains running.

## Reproduction and local receipts

1. Start the installed packaged app with its normal product data directory,
   without any data-directory override environment variables. Check each
   provider's user-level `ticketry` entry resolves to the packaged hook and
   canonical global arguments.
2. Choose a directory outside all registered module paths. Start plain
   `claude` and `codex`, without per-launch MCP configuration. Ask each to
   call `list_projects`, `get_task_details` for a known key, and
   `terminate_current_run`; record the successful reads and global refusal.
3. Quit Ticketry through the application menu. Repeat `list_projects` in
   those same sessions. Record the unavailable error and verify the original
   provider PIDs remain alive.
4. Restart the installed app. In Claude use `/mcp` → `ticketry` → Reconnect;
   repeat both reads in the original sessions and record their receipts.
5. Launch one Claude and one Codex acceptance agent from Ticketry. Have each
   call `list_projects`, an own-project filtered `list_tasks`, then
   `terminate_current_run`. Verify the accepted termination request separately
   from the persisted exited state and disappearance of its tmux session.

Local, redacted extracts used here:
`/tmp/coding-2684-run-receipts.json`, `/tmp/coding-2684-runs.json`,
`/tmp/coding-2684-codex-online.txt`, `/tmp/coding-2684-codex-offline.txt`,
`/tmp/coding-2684-codex-recovered.txt`, and
`/tmp/coding-2684-offline-wire.json`. Claude's online and `/mcp` captures are
`/tmp/coding-2684-claude-online.txt` and
`/tmp/coding-2684-claude-mcp-reconnect.txt`. These temporary files are not
repository artifacts; this document preserves the selected results without
provider configuration, credentials, generated binaries, or database copies.
