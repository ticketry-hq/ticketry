# Ticketry desktop agent acceptance

Run the frontend-to-agent proof from the repository root:

```sh
bun run --cwd studio test:e2e:desktop
```

The command builds a debug Tauri application with the test-only embedded
WebDriver feature, then drives Ticketry's visible React UI inside its macOS
WKWebView. It does not need a running Vite development server.

The run starts from a fresh temporary installation, completes provider
onboarding, confirms the module-folder trust prompt using a temporary Codex
configuration directory, and creates a module and Story.

It then proves the Story description seam in WebKit before anything is running
(CODING-1528): it clicks the description, types into the rich Markdown editor
through WebDriver contenteditable text input rather than assigning an editor
value, leaves the editor to
autosave, switches
to a second Story and autosaves a different description there, reloads the webview,
and requires each Story to show its own authoritative description — the text
the server returned, not a surviving local draft. The rich editor must be the
path taken; falling back to the Markdown source textarea fails the scenario.
The Chromium suite keeps its own Save and Cancel coverage unchanged.

The run then clicks **Run item**. The click
enters the production Tauri command and real Rust launch authority, terminal,
MCP, hook-spool, lifecycle, and reconciliation services. Ticketry starts a real
child process in an isolated private tmux server.

The child is a disposable `codex`-compatible executable created under the test
directory. It answers `--version`, prints deterministic output, reports normal
hooks through the packaged hook runner, moves the Story through Implement,
Review, and Done over Ticketry's MCP boundary, and exits with a fixed success
code. It never invokes Codex, another paid provider, or a network model API.

The UI observes the active run, task and module lifecycle indicators, terminal
activity, every state move, and the completed run. It also verifies that the
module aggregate clears after completion. The suite reloads the webview,
restarts the Rust process over the same isolated data directory, and verifies
that Done and the completed terminal remain visible. Success, failure, and
interruption stop the app and private tmux server and remove the temporary
profile and database.

The harness holds ports 8123 through 8132 from before desktop startup through
provider execution. It requires ready health and the MCP socket in the isolated
data directory, checks that the disposable provider receives the packaged stdio
bridge command with non-empty launch authority, and observes the provider move
the Story through that Ticketry instance.

On failure, diagnostics are copied to the ignored `studio/test-results/`
directory before the isolated runtime directory is removed. They include a
screenshot, DOM and frontend diagnostics, Rust stdout/stderr, private tmux
inventory and pane output, and disposable provider evidence. Direct macOS
WKWebView automation cannot produce a Playwright trace; the browser-only suite
retains Playwright tracing for its own seam.

Prerequisites are macOS, Node.js, Rust/Tauri build dependencies, and tmux.
`TICKETRY_DESKTOP_ACCEPTANCE_TMUX` may point to a nonstandard tmux executable.
The embedded WebDriver is enabled only by the Rust `desktop-acceptance` feature
and is absent from production builds. The harness exposes no REST service,
database API, or unrestricted shell endpoint.

## Isolated installation lifecycle

`scripts/desktop-agent-acceptance.mjs` holds only the Run item journey. The
fresh installation it runs in comes from `scripts/desktop-installation.mjs`,
which any further desktop scenario reuses instead of copying it:

- `runDesktopInstallationScenario({ providerScript, diagnostics }, scenario)`
  creates the temporary root, copies the built application and hook runner,
  stages the native libghostty resources, and writes the disposable tools.
  It runs the scenario, retains diagnostics on failure, and always cleans up.
- `providerScript` is the scenario's own Node provider. The approved `codex`
  executable runs it as `node <providerScript> <root> ...args`, so a scenario
  changes the provider without editing the lifecycle.
- `installation.start()`, `stop()`, `quitOrderly()` (this PID only, through
  `NSRunningApplication`), `killHard()` (SIGKILL) and `restart()` always reuse
  the same data directory. The first start holds the obsolete MCP ports and
  waits for the MCP socket to answer `mcp_ping`.
- `installation.tmuxInventory()`, `tmuxCapture()` and `waitForTmuxEmpty()`
  read the private tmux server.
- `installation.trackHelperProcesses()` registers provider and bridge PIDs.
  Cleanup on success, failure, SIGINT or SIGTERM stops Ticketry, the private
  tmux server and those helpers, then removes the temporary profile. It signals
  only helpers whose command line still names the installation root.
- `buildDesktopAcceptanceApplication()` runs the debug `desktop-acceptance`
  build unless `TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD=1`.

The focused modules live under `scripts/desktop-installation/`. Run
`bun run --cwd studio test:e2e:desktop:installation` to prove provider
registration, interrupt cleanup and the PID-reuse guard without building the
application.

## Subtree stub agent

Campaign scenarios pass `scripts/desktop-subtree-stub.mjs` as their
`providerScript`. Each stub reads its identity only from its own launch: the
factual prompt's `Work Item ID`, `Project ID` and `State` lines, and the
bridge's `--agent-run-id`. It shares that parsing with the single-run provider
through `scripts/desktop-provider-launch.mjs` and never reads `provider-task`.
It moves its work item one stage (default `Implement` → `Review`) through the
run-scoped MCP and reports `SessionStart`, `UserPromptSubmit`, `PostToolUse`
and `Stop` through the packaged hook runner.

Script timing with `subtreeStubHarness(installation.root)` from
`scripts/desktop-subtree-stub/harness.mjs`:

- `controlWorkItem(id, { mode })` before the press, or `controlRun(runId, …)`,
  which takes precedence. `mode` is `complete`, `hold` (also used when no
  control exists) or `exit-after-move`. `moveTo`, `mcpRetryMillis` and
  `signalTimeoutMillis` are optional.
- `release(runId)` lets a held stub move and exit. `release(runId,
  { exitAfterMove: true })` keeps it live after the move until
  `signalExit(runId)`.
- `startRecords()`, `waitForStart({ workItemId })`, `waitForMove`,
  `waitForCompletion`, `mcpResponses` and `hooks` read the records under
  `<root>/subtree-stub/runs/<agentRunId>/`. Start records carry the run and
  work item ids, the launch state, the stub and bridge PIDs, the CWD and
  `monotonic_ns`. Completion records add `moved_to`, `bridge_pids` and the end
  `monotonic_ns`, so you can compare them across stubs.

MCP calls retry JSON-RPC errors, transport failures and a replaced bridge for
a bounded time, so a stub released after a Ticketry restart reconnects. Run
`bun run --cwd studio test:e2e:desktop:providers` for both providers'
contracts.

## Subtree journey

The subtree journey (CODING-2852, CODING-2854, CODING-2855) is a separate command from the single-item
`test:e2e:desktop` journey:

```sh
bun run --cwd studio test:e2e:desktop:subtree
TICKETRY_EDITION=core bun run --cwd studio test:e2e:desktop:subtree
```

It builds the acceptance app for the edition named by `TICKETRY_EDITION`
(`pocock` when unset; `TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD=1` reuses an
existing build) and runs that edition's fixed case list from
`scripts/desktop-subtree-acceptance/edition-cases.mjs`. Pocock runs `serial`
and `recovery`; core runs `serial`, `parallel` and `recovery`. Each case
creates its own root and children and requires no private tmux session before
its press, so no case depends on another's order or leftovers. Once the app is up, and
before any case runs, the journey requires the running app to be the
requested edition. It checks the runtime configuration's `edition` when the
build reports one, and the edition-filtered global MCP tool list (the sprint
tools are core-only). A mismatch fails at once.

The Pocock fixture:

- Onboards Codex and creates and trusts a module through the Module Manager.
- Uses the seeded reviewed-defaults workflow unchanged.
- Creates a `Story` root in `Implement` with three `Implementation`
  children. Each child has a distinct stored sequence and no blockers, and its
  stub is held.
- Requires that, before the press, the root has no agent run and there are no
  private tmux sessions.

The core fixture builds the workflow the core edition does not seed:

- Onboards Codex and creates and trusts a module through the Module Manager,
  then ends the guided tour after the first-module step (**Finish tour**, or
  **Skip tour** while the build still offers Story capture). It never expects
  Story capture.
- Builds `Implement` (started), `Review` (started) and `Done` (completed);
  `Story` and `Implementation` task types starting in `Implement`; an
  agent-allowed `Implementation` `Implement → Review` edge; a prompted
  `Implementation`/`Implement` launch binding; and **Run subtree** enabled on
  the prompted `Story`/`Implement` binding. It uses only the generated
  workflow operations the Workflows settings issue
  (`create_state`, `worktrackerIssuetypeCreateOne`, `update_issue_type`,
  `create_issue_type_transition`/`update_issue_type_transition`,
  `upsert_issue_type_launch_binding`) over native `graphql_execute`, one
  revision-guarded step at a time, planned by the pure
  `core-workflow.mjs`. A state or type that already exists by name is adopted,
  not duplicated, so the fixture also runs on a build that still seeds
  reviewed defaults.
- Requires the Stories pane to no longer read "No workflow yet" and idea
  capture to be enabled, then creates the same hierarchy as Pocock.

The `serial` case:

1. Requires that Details offers no **Run subtree**.
2. Presses **Run subtree serially**, then expects the toast and **Open subtree
   run** with its lifecycle badge.
3. For each child in stored sequence order, it requires:
   - exactly one start and a settle window with no other start;
   - for the first child only, that **Open subtree run** focuses the child's
     native terminal.
4. Releases the stub. The child must show `Review` in the UI and in persisted
   data, and its run and tmux session must end before the next child starts on
   its own.
5. At the end, requires that:
   - start times follow completions;
   - the controls are restored;
   - nothing is left alive.

At every sample, duplicate and orphan checks use only existing reads:

- graph-run holding;
- live and ended agent runs;
- the private tmux inventory;
- `get_dependency_graph`;
- the stubs' records.

The core `parallel` case presses **Run subtree** with every stub held and
expects **Subtree run started.** and a `parallel` graph-run holding. Before any
release, all three children must have started, with three distinct agent run
ids, each run unfinished and owning its own live private tmux session, and no
second start through a settle window. Released, every child shows `Review` in
the UI and persisted data, every run and session ends, and both **Run subtree
serially** and **Run subtree** return.

The `recovery` case (both editions) runs a held serial campaign through two
restarts over the same data directory:

1. **Crash while live.** Once child 1's stub has started, SIGKILL Ticketry and
   restart. Child 1 must keep its agent run with the private tmux inventory
   unchanged, no child may start again through a settle window, and **Open
   subtree run** must return. Released, the re-adopted stub's MCP move must
   succeed through its bridge after the restart; child 2 then starts once.
2. **Quit with advancement owed.** Child 2 is released with exit-after-move.
   Once it shows `Review` (and child 3 has still not started), Ticketry quits
   orderly (this PID only). With Ticketry down the stub is signalled to exit;
   its stub and bridge PIDs must end and its pane must be dead. Ticketry keeps
   exited panes (`remain-on-exit`), so the session itself is removed by the
   next start's reconciliation. After the restart, child 2's run ends and
   child 3 starts exactly once.
3. Child 3 finishes, and the shared ordering and final duplicate/orphan checks
   run.

The in-flight orphan check runs after each restart. The case reads
`installation.browser` afresh because every restart opens a new WebDriver
session.

Launch claims have no public read, so they are counted through agent runs. Run
`bun run --cwd studio test:e2e:desktop:subtree:checks` for the journey's
pure checks.

On failure the journey copies its evidence to
`studio/test-results/desktop-subtree-acceptance-<timestamp>/` and prints that
path: `failure.png`, `frontend-diagnostic.json` (DOM, URL and console errors),
`ticketry.stdout.log`/`ticketry.stderr.log` (Rust logs), `tmux-inventory.txt`,
`provider-output.log` (pane output) and the whole `subtree-stub/` record
directory (start, move and completion records, MCP responses and hook events).

CI runs the journey as the `desktop-subtree` job in `.github/workflows/ci.yml`:
one `macos-26` leg per edition (`pocock`, `core`) with `TICKETRY_EDITION` from
the matrix, `fail-fast: false`, a 45-minute timeout and the desktop job's
repository-only guard. A failing leg uploads `studio/test-results/` as the
artifact `desktop-subtree-diagnostics-<edition>`. The `desktop` job and its
`test:e2e:desktop` step are separate and unchanged.
`scripts/desktop-subtree-acceptance/ci-gate.test.mjs`, part of the pure checks,
fails if the job's matrix stops matching the journey's editions.

For the focused stage-skill launch case (CODING-2724), run:

```sh
bun run --cwd studio test:e2e:desktop -- --stage-skills
```

It configures a skill through the Ideas state editor, creates and trusts a
disposable git worktree, then launches the fixture through Run item. A skill
present only in the module checkout must still produce a warning for the
provider running in the worktree. The warning remains visible after a tab
revisit and webview reload. Installing the skill in that checkout makes a fresh
run launch without warning. The provider records its actual CWD and unchanged
stage-skill prompt; skill-tree snapshots ensure launch checks never write them.
This case uses the same isolated app, provider, tmux and failure-artifact cleanup
as the lifecycle scenario and never calls a paid provider.

For browser compatibility and GraphQL behavior, run instead:

```sh
bun run --cwd studio test:e2e
```

That Playwright suite intentionally expects agent launch to be unavailable in
browser mode and must not be cited as agent-execution proof.
