# CODING-1561 MCP release verification

Verification on 2026-09-08 in the shared, already modified workspace. This
Implementation task has no children. Its CODING-1560 dependency was unblocked.

## Changes

- Desktop development builds and stages the Cargo hook before invoking Tauri.
  The build selects the host target and an explicit output directory.
- Release inspection executes the embedded `ticketry-hook mcp --help`.
- The bridge retains partial socket frames when concurrent provider input wins
  `tokio::select!`. A subprocess regression reproduced lost response bytes
  before the fix and passes afterward.
- Real bridge/runtime acceptance covers independent reconnecting processes,
  orderly shutdown, SIGKILL and stale sockets, persistent credentials, task
  reads and a legal task transition. It shares the existing MCP SQL fixture.
- Desktop acceptance keeps its disposable Codex-shaped provider and bridge
  alive through orderly exit and SIGKILL, records identities, and checks
  correlated outage errors and recovery. This fixture is not a real provider CLI.
  It copies the acceptance-enabled desktop before waiting on the hook build,
  preventing later Cargo builds from replacing the artifact selected for the run.
- Corrected terminal output fixture columns, obsolete launch-test columns,
  and terminal acceptance teardown.
  Added the existing `begin_write` root export to the public API fixture after
  checking its terminal viewer lease callers.

## Passed checks

- Required Rust packages: `ticketry-mcp`, `ticketry-launch`, `ticketry-desktop`.
  159 tests passed across unit and integration targets.
- Root MCP acceptance: 7 tests.
- Real bridge/runtime recovery: orderly stop and SIGKILL, three unchanged
  bridge/run identities, legal update, reopened credential rejection, and
  historical ports occupied. Hook CLI and protocol regressions: 8 tests.
  The one ignored Rust test is the subprocess server entry that this recovery
  case explicitly launches, rather than an unexecuted acceptance scenario.
- Terminal output activity: 15 tests. Terminal crate unit tests: 105 tests.
- Root terminal launch: 16, resume launch: 3, reconciliation: 9, and Agent Run
  lifecycle: 6. The final run retained the `desktop-acceptance` feature so
  concurrent desktop validation could not select a featureless executable.
- Public API boundary: 1 test.
- Studio overhaul: 132 files, 444 tests.
- Development/build script subset: 69 tests. Full release suite: 139 tests.
- Startup/log tooling: 30 tests.
- Disposable provider subprocess/configuration: 2 tests.
- Final focused desktop MCP run exits successfully. Orderly and SIGKILL
  outage errors take 0.52 ms and 0.40 ms. Both reconnects preserve all checked
  identities, legal Implement/Review/Done writes succeed, and lifecycle hook
  receipts are present. The isolated desktop and private tmux server are
  stopped and disposable directories removed. This is the Codex fixture,
  not the real-provider matrix.
- Isolated desktop recovery receipts in
  `studio/test-results/desktop-agent-acceptance-1788838775498/` prove orderly
  and SIGKILL recovery with unchanged provider PID, bridge PID, run ID,
  fixture conversation identity and private tmux inventory. Correlated outage
  errors took 1.348 ms and 0.366 ms. Both reconnects returned successful
  `list_tasks`; subsequent Implement, Review and Done transitions succeeded.
  The broader harness then failed in its unrelated Shell 1 UI assertion.
- Actual host Cargo hook build, target-named staging, and staged hook help.
- Existing arm64 release bundle has the expected main and hook executables,
  no forbidden or unexpected executables, and passes deep strict signature
  verification. Its embedded hook's `mcp --help` succeeds.
- `git diff --check`.
- Three isolated launches of the existing packaged artifact exit successfully.
  Listener stages are 3, 2, and 3 ms; runtime-ready totals are 1356, 596, and
  553 ms. Same-machine normal development history has listener stages of
  9, 13, 22, 27, and 33 ms. No repeatable listener regression is indicated.

## Real provider CLI matrix, 2026-09-09

The public acceptance seam was each provider CLI's native configuration into
the packaged stdio bridge, followed by `list_tasks` and a no-op
`update_task_status` of CODING-1569 from `Implement` to `Implement`. The no-op
write returned `ok: true` and left the work item unchanged.

- Claude Code 2.1.266 passed. `/Applications/Ticketry.app` 0.2.0 supplied the
  packaged hook, SHA-256
  `42d34bbd27938ee09dc36833301064b6e06f3a40694e66f7a03b43d6ef62a919`.
  Claude accepted `--mcp-config`, expanded
  `${TICKETRY_MCP_AUTHORIZATION}`, connected `worktracker-agent`, found
  CODING-1569 with a state-filtered `list_tasks`, and returned
  `{"ok":true,"status":"Implement","task_id":"ea27c220-e658-40df-9fe3-25e1057aef60"}`.
  Session `0605362f-f68e-47db-97c3-1667dadbdbe8`; tool calls
  `toolu_01RJdPWBXPd6LiyWKr5BLFoy` and
  `toolu_01Wpo6z1jnZzgGPJ2AtVKvw2`; CLI exit 0.
- Codex CLI 0.153.4 passed. The generated
  `mcp_servers.<name>.env_vars=["TICKETRY_MCP_AUTHORIZATION"]` form was accepted
  by `codex exec --ephemeral`; the inherited variable authenticated the packaged
  bridge. `list_tasks` found CODING-1569 and the no-op update returned the same
  successful JSON receipt. Thread
  `01a085e4-03d0-7cd0-95ba-6f8036e23196`; CLI exit 0. A negative control with
  the variable removed stopped at `TICKETRY_MCP_AUTHORIZATION is required`.
- Gemini CLI 0.59.0 was installed. It accepted the generated system settings,
  expanded the credential, initialized the packaged bridge, enumerated the
  WorkTracker tools, and skipped the trust prompt with `trust:true` and
  `--skip-trust`. A negative control without `--skip-trust` marked the folder
  untrusted and disabled the server. The conversation calls remain blocked
  because this machine has no valid Gemini API key or Gemini OAuth login; a
  dummy key reached model authentication and failed with `API key not valid`.
- Agy 1.1.19 failed the generated configuration before tool discovery. Agy
  ignores `GEMINI_CLI_SYSTEM_SETTINGS_PATH`; both with and without Ticketry's
  generated file, `agy mcp list` reported no servers. Its installed MCP guide
  and `agy mcp add` use `~/.gemini/config/mcp_config.json` instead. A temporary
  native MCP entry proved that Agy also leaves
  `${TICKETRY_MCP_AUTHORIZATION}` literal, so the bridge never authenticated
  and neither requested tool appeared. Conversation
  `2cb7d8d0-ab03-4f2d-9ab2-c28808e9a951` returned both calls false. The entry
  was removed. Persisting the live credential in Agy's global config was not
  attempted.

Claude also misreported an unfiltered 82 KB `list_tasks` result as
`Connection lost; execution outcome may be unknown`; the state-filtered call
succeeded. This is a provider result-size problem, not a bridge authentication
failure.

Local socket/port fixtures required execution outside the filesystem sandbox;
their initial sandbox `EPERM` failures are not product failures.

## Remaining evidence limits

- Gemini still needs an authenticated conversation to execute `list_tasks` and
  `update_task_status` after its packaged bridge initializes.
- Agy needs a per-launch MCP configuration mechanism that does not persist the
  bearer token. Ticketry's current Gemini system-settings injection is ignored
  by the installed Agy CLI.
- Thirteen legacy terminal integration cases invoke the removed
  `backend/.venv/bin/python` and cannot construct their Django fixtures. They
  fail before exercising terminal behavior.
- The full desktop harness reaches WebDriver and creates a disposable story,
  but its separate description-editor check fails to receive typed keystrokes
  before provider launch. A focused attempt initializes the real bridge but
  encounters a native-renderer host assertion. A subsequent focused attempt
  passes MCP recovery before failing a later Shell 1 UI assertion. These UI
  checks are separate from the focused MCP connection scenario.
- Existing startup traces compare 1238 ms desktop startup with a 1247.5 ms
  same-machine baseline and a 22 ms MCP stage. Repeated frontend bootstrap
  events under one trace ID contaminate its later frontend timing.
- Packaged auto-exit smoke uses synchronous startup after webview creation.
  Its repeated timings do not establish ordinary asynchronous paint ordering.
- Current startup intentionally starts its service worker before window
  creation. An isolated trace closes readiness gates at 112 ms, records MCP
  at 845 ms, service readiness at 853 ms, and webview creation at 982 ms.
  This proves the gates close before MCP; it does not prove a preparing screen
  has painted before the listener starts. The acceptance wording needs this
  cross-campaign ordering difference resolved.

Generated binaries, build output, temporary databases and GUI evidence remain
in ignored or temporary directories. This task commits none of them.

## Focused desktop reproduction

Build with `desktop-acceptance` and preserve that executable before running
other Cargo commands. The successful run used:

```sh
TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD=1 \
TICKETRY_DESKTOP_ACCEPTANCE_BINARY=/private/tmp/coding-1561-desktop-acceptance-ticketry \
node studio/scripts/desktop-agent-acceptance.mjs --mcp-recovery
```

Its log is `/private/tmp/coding-1561-desktop-mcp-recovery-final.log`.
The focused flag omits separate description, native-renderer and shell UI
assertions; ordinary full desktop acceptance retains those checks.
