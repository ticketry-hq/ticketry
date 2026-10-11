# Ticketry web acceptance suite

This suite verifies browser compatibility and the public GraphQL contract.
Planning journeys also execute the real Rust background host with a local typed
provider. The [desktop acceptance suite](../e2e-desktop/README.md) covers
interactive agent launch and native desktop behavior.

Run the complete browser suite from the repository root:

```sh
bun run --cwd studio test:e2e
```

Playwright starts `scripts/web-dev.mjs` on dedicated test ports with an isolated
`TICKETRY_E2E_DATA_DIR` and `MUXED_FORCE_SQLITE=true`. The config owns its
automatically created profile; the feature runner owns each explicit
invocation profile and removes it after server shutdown. The suite never opens the developer or desktop application
database.

### Memory queue and warm servers

Every e2e server first takes a slot in a machine-wide queue
(`scripts/feature-e2e/stackSlots.mjs`), shared by all runners, worktrees and
agents of the user through `~/.cache/ticketry/e2e-stack-slots/`. A server starts
only when fewer than `TICKETRY_E2E_MAX_STACKS` are running (default one per
6 GB of RAM, so 2 on 16 GB) and when one more stack of
`TICKETRY_E2E_STACK_MEMORY_MB` (default 1200, the measured peak of adapter,
Vite, Playwright and Chromium) would still leave `TICKETRY_E2E_MEMORY_FLOOR_MB`
(default 2048) of the kernel's available memory. With no other server running,
one always starts. While waiting, the runner prints `[e2e-queue] … waiting`
with the reason and the holders; that is the queue, not a hang. Raw
`test:e2e` runs queue through `scripts/with-e2e-stack-slot.mjs`.

The feature runner builds the GraphQL adapter and hook runner once, then starts
their binaries directly. While one invocation runs, it boots the next
invocation's server through the same queue (`TICKETRY_E2E_LOOKAHEAD`, default
1; `0` disables warming). A warmed server still serves one fresh profile, and
onboarding stays inside the invocation. `startup-and-service-health` and
`background-discovery-and-recovery` always start when their turn comes.
Runner-started server output is in each invocation's `web-server.log`.

The `setup` Playwright project runs before Chromium. It uses the provisioned
`codex / gpt-5.4 / medium` catalog entry and completes the real
provider-onboarding UI. Test setup and verification use the same public GraphQL
contract as the application; the suite does not depend on the removed REST API.
Every browser case records requests and fails if a visible journey touches the
retired `/api/work-tracker` surface.

## Feature suites and the runner

The [feature map](../../docs/feature-map/README.md) is the single source of
truth for selection and coverage; there is no hand-kept registry. A feature's
identity is its map entry filename without `.md`, and its suite lives at
`features/<feature-id>.spec.ts`. Each suite wraps its cases in one top-level
`featureSuite("<feature-id>", options?, body)` call from
`features/featureSuite.ts`, which tags them `@feature-<feature-id>`. Every case
has a literal title and exactly one globally unique `@case-<case-id>` tag, and
the entry's coverage table cites only its own suite's cases. Options select
`isolation: "suite" | "case"` and `profile: "onboarded" | "first-run"`.
Change a feature's entry and suite together.

```sh
bun run --cwd studio test:e2e:feature <feature-id>[,<feature-id>…]
bun run --cwd studio test:e2e:features
bun run --cwd studio test:e2e:features --list [--json]
bun run --cwd studio test:e2e:features --check
```

The first command runs the named features; the second is the full-app run over
every mapped, non-excluded feature in the map's sweep order. `--list` prints
derived features, suite paths, isolation and cases; `--check` reports map/suite
drift and exits non-zero. `test:e2e:planning` remains an alias for the seven
Plan and Sprints features.

Each feature invocation owns a fresh profile (or one per case for
`isolation: "case"`) and its own onboarding. Use `--case <case-id>` or
`--grep <regex>` for focused evidence; filtered runs never establish full-app
completion. The runner disables retries, retains traces, checks exact
case/feature/project and onboarding identities, and records profile and provider
cleanup. Evidence lives in `.ticketry-dev/e2e-results/<run-id>/`: manifest,
derived registry, source hashes, working-tree patch, command and logs,
JSON/HTML reports, traces, screenshots, provider output, cleanup and coverage
summary. The summary lists `desktop-only:` and `manual:` cells and excluded
entries under "Not verified by the browser".
`.ticketry-dev/e2e-results/latest.md` points to the latest summary. Sources
changing during a run fail its evidence; historical Planning runs remain under
`.ticketry-dev/planning-results/`.

`fixtures/sprint-provider.mjs` is a free Codex-compatible executable selected
through `MUXED_APPROVED_CODEX_PATH`. It consumes the real host's stdin snapshot
and typed schema, then writes output to the host's supplied result path. File
signals release success/failure runs; cancellation uses the real host process
group. The optional empty-output mode publishes an actual empty typed result.
Rust validates, persists and publishes every success. Failure injection delays,
aborts or errors only at the GraphQL network boundary. Browser evidence does
not verify native Tauri/libghostty rendering or paid providers.

Runner guarantees are covered by `scripts/run-feature-e2e.test.mjs`,
`scripts/feature-e2e/*.test.mjs` and `scripts/playwright-profile.test.mjs`.

## Covered browser seams

- first-run provider onboarding, guided module/Story tour, persisted
  acknowledgement, and saved global model defaults;
- visible initial Rust-adapter outage feedback and manual bootstrap recovery;
- visible module creation with Rust folder validation and cancel safety,
  switching, canonical cross-surface reordering, keyboard-accessible hidden-tab
  persistence with sidebar retention, picker recovery, and all-hidden sidebar
  recovery, idea capture, search,
  Story details, saved and cancelled name/description edits, retyping, parent/child
  relationships, persisted task-to-task and task-to-module reparenting,
  hierarchy-cycle and guarded-delete protections, blocker and
  inverse-blocks navigation, state moves with Rust-provisioned colors across
  list and details surfaces, ordering, cancel-safe child deletion, parent-guard
  release, and confirmed deletion;
- task/workspace pane dragging and persisted layout, plus keyboard Modules-pane
  toggling and reload restoration;
- direct shortcut-help entry, shortcut discovery, filtering, focus restoration,
  persisted shortcut override execution and reset, search focus, and three-zone
  edit-view navigation, plus cancel-safe keyboard status selection with Rust
  persistence;
- Rust-backed module-shell creation, command input/output in the linked module
  folder, tmux output replay after reload, multi-shell tab selection and
  restoration, the four-shell cap, deterministic background-shell closure,
  visible nonzero shell exit and in-place restart, clean-exit tab disposal,
  terminal-panel mouse and keyboard toggles, persisted keyboard resizing and
  maximize mode, explicit shell termination, and missing-folder repair after
  external module-link removal, including Rust refusal of a nonexistent
  absolute path and in-place retry, stale-link refusal after a linked folder is
  deleted, persisted repair, plus keyboard-driven module-folder persistence and
  shell working-directory verification;
- issue-type-isolated Grill policy prompts, transition permission, auto-start,
  subtree-run, provider, model, and reasoning persistence through the Rust
  workflow contract, including Rust-catalog unsupported-model refusal before a
  write and without persisted drift, plus Models settings with save, discard,
  live picker convergence, and reload behavior;
- a Models settings save verified directly against the SQLite `app_settings`
  row through `scripts/read-persisted-model-settings.mjs`, proving the stored
  global launch default rather than the response the UI displayed;
- canonical Markdown document discovery, live Rust-watcher creation and deletion,
  editing, cancelled edits, unsaved tab switches, saving,
  per-work-item-isolated workspace-tab reordering and keyboard cycling,
  close/reopen position persistence, external-change comparison, cancel-safe
  and confirmed reload, explicit
  stale-digest overwrite, and reload persistence, plus sandboxed HTML rendering
  with Rust-served sibling assets, symlink-escape refusal, and verified
  parent-page isolation;
- New conversation's direct default-policy launch without starting a real
  provider process, plus keyboard task-agent, prompted-task, and Plan entry
  with cancel-safe provider handoff, and live Agent Picker
  convergence after Rust-backed provider activation changes;
- real Git worktree creation, filesystem dirty-state detection, reload
  persistence, nested-task checkout sharing, cancel-safe confirmation,
  confirmed discard, and independent Work Item completion that retains clean,
  dirty, committed, and diverged worktrees without changing the base checkout,
  plus the explicit direct-path fallback for modules outside Git;
- local-file attachment creation through the Rust MCP, missing-file refusal
  without phantom rows, and rendering through the shared GraphQL-backed
  work-item details, including reload persistence;
- ordinary Rust MCP root-Story creation, title/description replacement and
  append-without-clobber semantics, agent-authorized workflow moves, human-only
  transition refusal without state drift, including live open-page convergence,
  reload persistence, UI deletion, and fixture restoration;
- visible Run-now policy refusal against a missing typed module link, including
  proof that no workflow move occurs and linked-folder restoration;
- Rust MCP generic sub-task creation and mixed-result reparenting, including
  hierarchy-cycle refusal without parent drift, key-based parent resolution,
  missing-task reporting, live hierarchy convergence, reload persistence, and
  UI cleanup;
- Rust MCP blocker replacement, cycle rejection, and clearing, with canonical
  reload verification of both the blocked-by and inverse-blocks views;
- review-finding creation through the Rust MCP, malformed-evidence and
  out-of-phase refusal without child leakage, live status-stream convergence,
  evidence-location rendering, full finding-detail navigation, queued-fix
  accounting, user cancellation, and reload persistence;
- optimistic rollback, external GraphQL updates after canonical refresh,
  reconnect replay, and expansion state in the numbered overhaul regression.

The Playwright project intentionally contains no skipped tests. Behaviors that
need precise lifecycle state without executing a real coding agent are owned by
the executable numbered acceptance gate instead:

- `[overhaul-07]` collapsed branches retain descendant activity;
- `[overhaul-08]` keyboard terminal cycling enters collapsed branches;
- `[overhaul-09]` an externally lost terminal remains visibly dead;
- `[overhaul-10]` a dismissed terminal stays dismissed after restoration;
- `[overhaul-13]` a scratch launch produces its run summary.

Run that deterministic UI/state boundary alongside Playwright with:

```sh
bun run --cwd studio test:overhaul
```

The obsolete far-left Projects/Modules sidebar is intentionally outside this
suite. Native Ghostty/Tauri rendering, interactive or paid provider calls, and desktop
tmux death/reconnect behavior require the desktop acceptance harness. Planning
browser journeys cover the local typed provider process and host cancellation.

The agent feature suites also use `fixtures/sprint-provider.mjs` through
`MUXED_APPROVED_CODEX_PATH`. Its interactive branch reports the shipping hooks,
provides the Codex composer marker, and uses the credentialed stdio MCP bridge
for requested workflow transitions. It never calls a model or the network.
Existing workspace tests retain the default holding process. Agent suites write
`provider-fixture/agent-control.json` with `mode: "success"` or `"failure"`
before launching, then create `<run-id>.release` to let it finish (failure exits
23). Optional `states` lists workflow destinations to request through MCP;
identity comes from the real launch prompt, with `taskId`/`projectId` overrides
for prompt-free fixtures. `<run-id>.interactive.json` records the actual child
working directory, arguments, identity and PID; `.hooks.log` and `.mcp.log`
provide hook and transition evidence. `title-control.json` can set the
external provider's title, including `null`, for the resident title protocol.

Run all four agent entries with:

```sh
bun run --cwd studio test:e2e:feature agent-launch,agent-lifecycle-and-status,conversations,dependency-graph-runs
```
