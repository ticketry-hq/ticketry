# T650 — Bottom terminal panel: grill decisions

Ticket #650 · Work Item `5d9d7e05-772d-4622-87b2-103d61debd6e` · Grilled 2026-08-15

Comparison material: T3 Code (`coding/clones/t3code`), which ships the same
product surface on the same terminal library and made materially different
choices. Where a decision below diverges from theirs, the divergence is
deliberate and recorded.

## Decisions

1. **The panel is a shell surface, not a dock.** It hosts hand-driven shells
   only. Agent runs stay where they are, as terminal tabs in the Task
   workspace. A terminal tab *is* an agent run and is wired into the
   live-terminal cycle, subtree chicklets, and per-work-item active-tab memory;
   moving those tabs to a global bottom dock would detach them from the work
   item that gives them meaning. The dock remains available as a later move —
   this decision is additive, not a re-architecture.
2. **Shells are module-scoped.** A shell belongs to a module and opens in that
   module's module folder. Switching module tabs swaps the visible shell set,
   the same way terminal tabs already swap on work-item change. The module
   folder is the only concept in the domain that *is* a directory: projects
   have no path, and most work items have no worktree. T3 scopes to their
   thread instead; that is rejected here because a thread is document-like
   while a module is repo-like.
3. **Shells are durable and restored.** They are tmux-backed exactly like agent
   terminals, and survive app restart and sidecar rebuild. The decisive
   argument is that `TerminalRuntime` is documented as *the only*
   application-facing seam for terminal mechanics; a direct-PTY shell would be
   a second terminal runtime living beside tmux. T3's model — ephemeral process
   with a transcript persisted to a capped file and replayed on attach — is
   strictly weaker than what tmux already gives this codebase.
4. **A shell run reuses the `AgentRun` record.** `scope="shell"` discriminates
   it, `agent` becomes nullable, `issue_id` is the module id and `task_id` is
   `SCRATCH_TASK_ID` — the pattern scratch plan/instant runs already use,
   because a Module is itself an Issue. A parallel session concept was
   considered and rejected. See ADR
   `backend/apps/terminals/docs/adr/0002-shell-runs-reuse-the-agent-run-record.md`.
5. **The panel sits at the bottom of `TicketWorkspace`.** It spans the Stories
   and Selected-ticket panes and leaves the sidebar full height, so the panel's
   extent exactly equals its module scope — the module tab strip already bounds
   the same region above.
6. **Multiple tabs, no splits, capped at 4.** The panel owns its own tab strip
   with a create action. Exactly one shell is visible at a time, so at most one
   additional native view is ever presented. Opening the panel with no shells
   creates the first one. Splits are rejected for this ticket: every
   simultaneously visible shell is another native ghostty view needing its own
   frame, geometry and visibility reconciliation, which is the part of the
   native stack that has generated the most tickets.
7. **`Ctrl+\`` toggles the panel, strict two-state.** Closed opens and focuses;
   open closes, wherever focus currently sits. VS Code's actual three-state
   behavior (open-but-unfocused focuses rather than closes) was put and
   rejected. The binding must be registered in the **capture** keymap context,
   since terminal typing mode otherwise intercepts only Cmd+Esc. `Ctrl+\`` is
   currently unbound.
8. **Panel memory splits furniture from content.** The open flag and the
   panel height are global and persist across restarts; the shell set and the
   active tab are per module. This follows the split `studio/src/state/persistence.ts`
   already draws between global keys (sidebar visibility, panel layout) and
   per-module keys (expanded ids, task selections). T3 keys everything
   including height per thread; rejected because the panel would visibly
   twitch as you move across module tabs.
9. **No valid module folder means no shell.** The panel presents the existing
   module-folder selection affordance in place of a terminal. This is a
   deliberate divergence from `task_launch_preflight`, which silently falls
   back to `os.path.expanduser("~")`. A bare shell cannot explain itself the
   way an agent's prompt can, and a shell that looks like it is in your repo
   but is not is a silent, destructive failure mode.
10. **Exit 0 disposes the tab; a non-zero exit keeps it.** Typing `exit` closes
    the terminal, as in VS Code. A failing exit keeps the tab, shows the code,
    and offers restart, so a crash is never swallowed. Restart mints a *new*
    shell run in the same tab slot — the glossary is firm that a dead session
    is never revived.
11. **The browser build gets the panel**, rendering through the existing xterm
    fallback rather than a native view. Because a shell is a tmux-backed
    `AgentRun`, the transport, consumer and lease are shared and this costs
    essentially nothing.
12. **Viewers attach lazily.** Nothing attaches until the panel is actually
    opened; entering a module is not enough. The durable session is alive in
    tmux either way, so this decides only when a viewer attaches and a native
    view is built. `Ctrl+\`` therefore pays first-attach latency, which T529's
    hidden-until-ready gate already exists to keep from flashing.
13. **Two terms, one record.** `Agent run` keeps its current meaning unchanged
    and `Shell run` becomes its own term that happens to share the record.
    Generalizing the domain term to `Run` with kinds was offered — following
    the precedent `studio/CONTEXT.md` sets for Task/Issue vs Work item — and
    rejected.

## Verified during the grill

These were checked against the code rather than assumed, and two of them
changed a decision.

* **Run-counting surfaces do not need exclusion filters.**
  `selectScratchLifecycleChips` and `selectScratchRunIds` already filter to
  `plan`/`instant` scopes; `taskRunIds` matches real task ids and a shell run
  carries `SCRATCH_TASK_ID`; `selectModuleLifecycleCounts` has no scope filter
  but counts only runs carrying a lifecycle state, and lifecycle state arrives
  from agent hooks that a shell does not have. Contamination is nil. An earlier
  claim in this grill that four filter sites were needed was wrong.
* **The completion seam is a genuine no-op for shells.** Ending a shell run
  publishes `agent_run_terminated`, which reaches
  `execution.driver.observe_agent_run_terminated`; that filters `LaunchedTask`
  by run id and returns `[]` when there are no rows. A shell is never a
  `LaunchedTask`. No guard is required.
* **The tmux runtime and the native attach path are already id-agnostic.**
  Session names are `pt-{id}` from a single prefix constant on each side
  (`backend/apps/terminals/tmux/_core.py`, `studio/src-tauri/src/tmux_viewer.rs`),
  and Rust merely validates the id as an opaque string. Neither needs changing.
* **Multiple native views can be presented simultaneously.** The native API is
  per-run (`native_terminal_set_frame`/`_hide`/`_show`/`_focus`/`_detach`,
  entries keyed by run id) over real AppKit views at explicit frames. "One
  presented viewer" is a policy in `RetainedTerminalViewers`, per bucket, not a
  mechanism limit. Keyboard focus is the genuinely singular resource.
* **Foreground claims cannot collide.** They are keyed by run id, and a shell
  run is a different run from any agent run, so `foregroundStore` needs no new
  owner.
* **`Ctrl+\`` is unbound.** No binding in `keymapBindings.ts` uses Backquote.
* **A Module is an Issue**, which is why `control_plane.py` can already set
  `issue_id = request.module_id` for taskless runs.

## Defaults taken without a decision (conventional)

* Cap of 4 shells per module, matching T3's `MAX_TERMINALS_PER_GROUP`.
* The shell command is the login shell (`$SHELL -l`), inheriting the same
  launch environment as agent runs minus agent-specific variables
  (`MUXED_APPROVED_*`, the lifecycle URL — a shell has no hooks to report).
* Closing a tab explicitly terminates the tmux session and ends the run.
* The panel joins the Shift+Tab navigation-zone cycle as a fourth zone.
* Panel height follows T3's 280px default.

## Out of scope, deliberately

* Terminal splits.
* Server-computed tab labels naming the running subprocess (T3 shows
  `npm run dev` rather than `zsh`, via a `hasRunningSubprocess` activity
  event). Good follow-up; not this ticket.
* T3's terminal-context feature — selecting lines in a terminal and attaching
  them to an agent prompt as `@term-1:12-30`.

## Docs written

* `backend/apps/terminals/CONTEXT.md`: added **Shell run** and **Shell
  restart**.
* `studio/CONTEXT.md`: added **Terminal panel** and **Panel shell tab**.
* `backend/apps/terminals/docs/adr/0002-shell-runs-reuse-the-agent-run-record.md`.
