# CODIN-753 — Refinement notes (working doc)

Follow-up to CODIN-703 / CODIN-751. Revive terminated agent runs by run id.

## Domain grounding (facts established from the repo, not decisions)

### Two distinct meanings of "revive" — this ticket is the second
- **Reattach**: connect a viewer PTY to a *still-alive* tmux session. Already fully
  plumbed (`mode:"attach"` WS frame → `_handle_attach` → tmux viewer). CODIN-751 owns
  live/restorable sessions via this path.
- **Resume (this ticket)**: a terminated run's tmux session is **killed** on terminate
  (`tmux.terminate_session`), so reattach is impossible. Reviving a *terminated* run can
  only mean **launching a new agent process that continues the prior conversation** via a
  provider resume flag, keyed off the persisted provider session id.

### Durable identity persisted per run (`AgentRun` + linked `AgentTerminalSession`)
- `agent_run_id` — the durable, user-facing run id (always present).
- `provider_session_id` — **nullable**; the provider-native resumable id. Only populated
  if the agent's lifecycle hook fired at least once during the run.
- `cwd`, `design_dir` — persisted; the run's working dir and generated-docs dir.
- `tmux_session_name` — killed on terminate; not usable for terminated runs.
- `terminated_at` — soft-delete marker. **Rows are retained, never deleted**, so terminated
  runs remain queryable as history.
- `scope` — task | plan | instant | docchat.

### Provider capability matrix (updated after local implementation review 2026-07-07)
The initial Explore claim that Codex doesn't capture a session id was WRONG.
`apps/terminals/agents/hooks/codex_hook.py` already reads `session_id` off every
Codex hook event and forwards it as `provider_session_id` (same as Claude/Gemini).
So there is **no capture gap to work around** for the three real providers.

| Provider | provider_session_id captured today | resume invocation (interactive TUI) | notes |
|---|---|---|---|
| Claude | yes (hook, from SessionStart) | `claude --resume <id>` | `--continue` = most-recent in cwd |
| Gemini | yes (hook) | `gemini --resume <id>` (`-r`) | sessions are **per-project-dir** (`~/.gemini/tmp/<hash>`); no initial-prompt flag |
| Codex  | yes (hook, `session_id` on every event) | `codex resume <id>` (SUBCOMMAND, not a flag) | headless variant `codex exec resume <id> "prompt"` |
| Agy    | yes, when hook payload includes `conversationId` / `conversation_id` | `agy --conversation <id>` | generic `sessionId` is ignored because it is not proven resumable |

Revival is feasible for **Claude, Gemini, Codex, and Agy** for any terminated run
whose `provider_session_id` is non-null and whose persisted `cwd` still exists.

### Facts that shape failure modes
- Provider transcripts live in the user's HOME (`~/.claude`, `~/.gemini/tmp/<hash>`,
  `~/.codex/sessions/YYYY/MM/DD/`), **not** in the worktree. They survive worktree
  deletion — but Codex archives old sessions (`~/.codex/archived_sessions`) and each
  provider has its own retention, so a transcript can be gone.
- Relaunch still needs a valid `cwd`. Per-task worktrees are merged back / removed on
  Done (#585/#589), so a revived run for a completed task may have a `cwd` that no
  longer exists.
- Gemini binds sessions to a project-dir hash, so resuming a Gemini run in a different
  cwd than it started in may not find the session.
- Codex's resume argv is a subcommand (`codex resume <id>`), unlike Claude/Gemini flags,
  so `commands.py` needs a per-provider resume branch.
- Interactive TUI resume (what our tmux runs are) generally drops the user INTO the
  conversation; Gemini has no initial-prompt flag, so a uniform design injects no new
  prompt on revive (user continues typing).

### The launch seam
- `spawn_run()` (terminals/launch.py, #715) is the issue-scoped, non-WS launch primitive.
  It always mints a fresh `agent_run_id` and has **no resume input**.
- `commands.py` builds the agent argv with **no resume/continue flags**.
- Revival should extend this seam (e.g. an optional `resume_from_run_id`), NOT assemble
  scope in the drawer UI — consistent with the CODIN-703/748/751 issue-scoped boundary.

### Frontend state
- `persistedSessions` already includes terminated rows (`terminated_at: string|null`).
- Auto-reattach explicitly **skips** terminated runs.
- CODIN-751 explicitly **removed** terminated-run history chips from its scope. Today
  nothing surfaces terminated runs in the drawer.

## Final verification (2026-07-07)

### Locked semantics
- The revive input is the durable `agent_run_id` of an ended `AgentRun`.
- The provider-native resume key is `AgentRun.provider_session_id`; runs without it
  are not listed as resumable and return `no_provider_session_id` if requested.
- Revival always launches a fresh tmux-backed run with a new `agent_run_id`; the new
  row records `resumed_from=<old agent_run_id>`.
- The revived run reuses the old run's `agent`, `project_id`, `module_id`, `task_id`,
  `cwd`, `design_dir`, `workspace_slug`, scope, and doc path. It does not rebuild or
  inject a new task prompt.
- A missing `cwd`, still-active source run, unknown source run, unsupported provider,
  unknown provider, or launch failure is surfaced as a typed resume error.

### Implemented surface
- Backend:
  - `POST /api/terminals/resume?agent_run_id=...`
  - `GET /api/terminals/resumable?task_id=...`
  - `AgentRun.resumed_from` migration and model field
  - provider resume argv in `apps.terminals.agents.registry`
  - `TerminalSessionService.resume()` launch seam
- Frontend:
  - task drawer fetches resumable terminated runs after persisted-session refresh
  - resumable runs render as `↻ <agent>` dormant chips
  - clicking a chip calls resume, refreshes persisted sessions, attaches the new run,
    and selects the Terminal tab
  - error handling shows user-facing toasts and refreshes stale resumable history

### Acceptance signal
The implementation satisfies the original follow-up: terminated runs with durable
provider identity are shown as resumable history records, revival flows through the
orchestration/session seam by old run id, and the resulting fresh run becomes a normal
live/restorable drawer Terminal tab.

## Open decisions (to be resolved during this grill)
Resolved by the final verification above.
