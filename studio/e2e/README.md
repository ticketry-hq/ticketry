# Ticketry web acceptance suite

This suite proves browser compatibility and the public GraphQL contract. It
does **not** prove that Ticketry can launch an agent. The separate
[desktop acceptance suite](../e2e-desktop/README.md) owns that proof.

Run the complete browser suite from the repository root:

```sh
npm run test:e2e --workspace @worktracker/studio
```

Playwright starts `scripts/web-dev.mjs --temp-sqlite` on dedicated test ports.
That launcher creates and provisions a new SQLite profile for the invocation,
points every web service at it, and deletes the profile when Playwright shuts
the server down. The suite never opens the developer or desktop application
database.

The `setup` Playwright project runs before Chromium. It uses the provisioned
`codex / gpt-5.4 / medium` catalog entry and completes the real
provider-onboarding UI. Test setup and verification use the same public GraphQL
contract as the application; the suite does not depend on the removed REST API.
Every browser case records requests and fails if a visible journey touches the
retired `/api/work-tracker` surface.

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
- Local scratch workspace Plan/Instant launcher-menu behavior without starting
  a real provider process, plus keyboard task-agent, prompted-task, Plan, and
  Instant Change entry with cancel-safe provider handoff, and live Agent Picker
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
npm run test:overhaul --workspace @worktracker/studio
```

The obsolete far-left Projects/Modules sidebar is intentionally outside this
suite. Native Ghostty/Tauri rendering, real provider processes, and tmux death
or reconnect behavior require the desktop acceptance harness rather than a
deterministic web Playwright run.
