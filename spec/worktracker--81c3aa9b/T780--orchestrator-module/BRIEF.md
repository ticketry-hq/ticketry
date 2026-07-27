# Orchestrator Module (CODIN-780) — Implementation Brief

**Date:** 2026-07-03
**Status:** Design complete, stress-tested (3-round adversarial grill), owner decisions locked. Ready to build.
**Audience:** Implementation agent. This document is self-contained — everything decided about this project is here. The WorkTracker tickets (IDs below) carry the same content per-slice; this is the master context.

---

## 1. Vision & Motivation

Build a **deterministic, recursive agent-orchestration layer** that gets more out of coding agents — either "build more without watching them" or "build the same with older/cheaper models." The core bet: a deterministic software script coordinating agents (calling them differently, recursively, with the right model at the right depth) saves real time and money.

Scope of v1: **coordination between agents for a SINGLE parent ticket**. The coordinator creates child tickets that hold the state of the entire task being executed. The tracker (worktracker) is the state store; the orchestrator holds only run bookkeeping.

### Relationship to prior art (#700)

This repo already contains an "execute dependency graph" engine (`server/apps/execution/`, ticket #700) that does phase-based planning (refine→split→register→lld) and topological execution. It proved the architectural pattern but **kept humans in the loop by design**: Backlog→Todo moves after refine, HLD approval after split, per-phase buttons, register/lld phases that never machine-complete, manual failure handling. Its BUILD-PLAYBOOK explicitly deferred "the orchestration state machine" — this module IS that deferred piece, plus machine-observable completion.

**The Muxed philosophy was divide-and-conquer with a human driving. This module's philosophy: human gates collapse from N mid-flight approvals to bookends — start the run, review/land the final branch — plus exceptions.**

---

## 2. Architecture Decisions (locked, with rationale)

### 2.1 In-place, not a separate service
- New Django app **`server/apps/orchestrator/`** in this repo, same ASGI server process.
- **HARD RULE: the orchestrator app imports ONLY from the `worktracker` app** (models, lifecycle, signals). It must **NEVER import from `apps/execution`** — that app is a frozen reference implementation. It must also not import from `apps/terminals` (tmux substrate). State this rule in the app's README/docstring. If the boundary holds, later extraction to a standalone service is mechanical.
- Rationale: agent writes arrive via MCP→HTTP into the server process, where the `issue_state_changed` post_save/on_commit signal seam fires. The orchestration loop must live in that process to see those events. Django signals only fire in the process that performs the write — a separate process importing the ORM against the same DB would go blind to agent writes. Studio keeps the HTTP layer alive anyway.

### 2.2 Dedicated launch path
- A **`pnpm orchestrate`** script is the ONLY entry that runs the orchestrator: boots the ASGI server with worktracker + orchestrator apps and the signal seam live, WITHOUT Studio dev-server / tmux scaffolding. Orchestrator routes are not mounted (or 404) under the regular dev entry.

### 2.3 Pattern reuse from #700 (as a pattern — zero imports)
- **Pure reducer + effectful driver**: `decide(state, event) → (next_state, actions)` with all I/O in a driver. Reducers are pure, framework-free, fully unit-testable.
- **Tickets-as-state**: board state group (backlog/unstarted/started/completed/cancelled via `state_groups`) = completion signal; `blocked_by` M2M = DAG topology, **re-derived live on every read, never persisted**; containment (parent/child) does not gate readiness — only `blocked_by` does.
- **Durable run header + rebuild-from-facts** after restart; 404 = no run, never "process restarted."
- **Idempotent re-invoke**: adopt live runs instead of double-launching; safe to mash the trigger.

### 2.4 Fresh state model
- Deliberately NOT reusing #700's phases or the deferred 19-state lifecycle machine (#744). States are added only when a transition must be machine-observed. The 19-state machine's lesson: designing states up front then deferring them left completion unobservable — build minimal, grow on need.

### 2.5 Launch primitive: headless subprocesses
- `codex exec` / `claude -p` subprocesses (NOT tmux). New run-record model in the orchestrator app (NOT `AgentRun`).
- Headless runs give **real exit codes** — a termination signal #700 never had (its runs stayed "running" forever in unobservable phases).
- Non-interactive **by construction**: launch flags must make permission prompts impossible (e.g. `claude -p` with appropriate permission mode, `codex exec` non-interactive). A hung interactive prompt is a launch-primitive bug.
- Capture: pid, full stdout transcript (stored on the run record), **token/cost usage parsed from CLI JSON output** (`claude -p --output-format json`; codex equivalent). Nearly free since stdout is captured anyway; feeds strategy A/B comparison.
- Inject the worktracker MCP config so spawned agents can flip states / write feedback via the existing MCP→HTTP path (unchanged).

### 2.6 Strategy packs
- A decomposition strategy = a named, **git-versioned directory of per-phase prompt templates** (e.g. `strategies/default/decompose.md`, `strategies/by-interface/decompose.md`). Selected per run; recorded on the run header for A/B comparison.
- v1 is **prompts-only with a fixed phase sequence**; sequence-shaping (strategy changes the phase graph) is deferred.
- Loader: `prompt_for(strategy, phase, issue)` with issue context interpolated. Unknown strategy/phase = hard error at run START, not mid-run.
- **Pack spec requirement: decompose prompts MUST require deterministic child slugs** — slug-idempotent ticket creation (proven by #700's register prompt) makes reconcile retries physically duplicate-proof.
- Contrast with #700: its `recipes.py` is hardcoded Python strings — no store, no variants. That's the structural gap this fixes.

### 2.7 Model/cost policy
- Policy maps **`(phase, depth, attempt) → (agent, model)`** — the "better or cheaper" lever #700 never had (one agent slug fixed for a whole subtree).
- Policy is an INPUT to the pure reducer where `LaunchAction`s are constructed — deterministic, testable. The launch primitive translates the chosen model to CLI flags.
- `LaunchAction` carries `(phase, strategy, model, task_id, prompt)`.

---

## 3. Execution Semantics (the hard-won details from the grill)

### 3.1 Two-signal completion model
- **Ticket state = success signal. Exit code = termination signal.** Exit 0 never means "correct"; it means "the agent stopped."
- Four quadrants:
  1. exit 0 + expected ticket transition → `done`.
  2. exit 0 + no transition → **`stopped_incomplete`** → ONE informed corrective relaunch → `failed` + surface. Never silent.
  3. exit ≠0 + transition already happened → `done` with a **loud anomaly flag** on the run record (the system may advance work the agent believed failed — keep this visible in run status).
  4. exit ≠0 + no transition → `failed`; halt transitive dependents; surface.

### 3.2 Postcondition framework (checked facts, not self-reports)
Each phase declares a machine-checkable postcondition the **DRIVER verifies at exit**:
- **decompose**: structural gate — all created children parented under the root; edge subgraph acyclic (re-validated by the driver even though the server's cycle guard enforces at write time); child count within policy sanity band (2..remaining-budget); every child has a nonempty description.
- **implement** (in `auto` mode): (1) ≥1 new commit on the node's branch (driver reads git), AND (2) the run policy's **check command** (e.g. `pnpm test`) exits 0, **executed by the driver in the node's worktree** — not the agent's claim. The ticket flip alone NEVER marks a node done in auto mode.
- If exit-0 + postcondition holds but the agent forgot the ticket flip, the **driver performs the flip** — removes a whole class of #700's wedges.
- No check command configured → `auto` mode is REFUSED at run start (gated only).

### 3.3 States
- **Node**: `pending → running → done | stopped_incomplete | integration_failed | failed | halted`.
- **Run header**: `running | done | failed | budget_exceeded | released`.
- `halted` = transitive dependent of a failed node (BFS outward along edges); independent branches keep draining.

### 3.4 Phases (v1)
- **`decompose → implement`** only. Decompose subsumes #700's split+register: ONE agent both proposes and creates the child tickets + `blocked_by` edges (gated by the structural postcondition + undo, below). No doc-writing phase blocks anything in v1 (strategies may have decompose write docs as a side effect).

### 3.5 Decompose undo + reconcile retry
- Driver snapshots the root's child set before decompose, diffs after exit; created-ticket ids recorded on the run record **per attempt, accumulated**.
- **Abort** = SIGTERM live processes, header → `released`, **cascade-archive run-created tickets** (reuses worktracker's #633 cancel→is_archived BFS cascade). Archive-on-abort defaults ON; keep-tickets is the opt-out.
- Decompose retry is **RECONCILE-based**: corrective prompt includes already-created children (ids, names, edges) + "complete this set; create what's missing; do not duplicate"; postcondition validates the UNION. Deterministic slugs (pack spec) are the mechanism that makes duplicates impossible; the prompt is the convention. Delete-and-recreate was rejected (discards good work, ambiguous mid-retry abort).

### 3.6 Retry rules
- **One retry per NODE** (not per launch — no multiplicative retries), counts against max_total_runs.
- Informed: corrective prompt carries postcondition diagnostics (which check failed, tail of driver's check-command output), tail of attempt-1 stdout, attempt-1's blocker note if any.
- **Blocker note present → NO retry** — a blocker note is the "task impossible" signal; straight to `failed` + surface. Strategy prompts must instruct agents to write a blocker note rather than exit silently.
- Model escalation on retry: **OFF in v1** (owner decision) — same model, then surface. The `(phase, depth, attempt)` policy axis exists so enabling it later is config, not code.

### 3.7 Concurrency & the event loop
- `max_concurrent` (default 3) enforced in the reducer's **capped ready-set** selection.
- **Fold serialization**: every fold (signal-triggered or exit-triggered) runs inside `select_for_update` on the run-header row — per-run serialization, cross-run parallelism.
- **Commit-then-launch**: folds never launch synchronously. Fold returns LaunchActions; driver executes them after the fold's transaction commits (`on_commit`). Next fold happens when that subprocess's exit or ticket write arrives as a NEW event through the same serialized path. Loop: event → lock → fold → persist → commit → side-effects. No fold-inside-fold.
- Subprocess supervision: `asyncio.create_subprocess_exec` + supervisor task per run folding `run_exited(code)`. Pid on the run record. After ASGI restart, rebuild-from-facts re-arms supervisors for adopted live pids (timeout from recorded start time); dead pid → postcondition check decides `done` vs `stopped_incomplete`.
- **Timeouts** (hang backstop, not pace expectation): per-phase from run policy; SIGTERM → grace → SIGKILL → fold `run_exited(timeout)`. Postcondition check still runs first (finished-but-hung lands in quadrant 3, not failed). Defaults: decompose 1h / implement 4h (owner: real runs take much longer than naive estimates; configurable).

### 3.8 Recursion brakes (three independent)
1. **max_depth** (default 2) enforced in the PURE REDUCER — nodes carry depth (parent+1 at creation); at-limit children get `implement` only, never decompose.
2. **max_total_runs = 10** (owner decision; hard, includes retries) enforced in the DRIVER at launch by counting run records under the header. Hit → header `budget_exceeded`, in-flight finishes, nothing new launches, loud surface. Never silent.
3. **Mid-run recursion via the trigger surface is BANNED in v1** — an implement agent calling "start a run" while holding a concurrency slot is a starvation deadlock (parents hold all slots waiting on children that can never launch). The reducer is the ONLY recursion engine. The MCP start-run tool REJECTS calls carrying a run context. Post-v1 sound version: **exit-and-supersede** (agent writes a decompose-request note and exits; reducer converts the node to a decompose node, freeing the slot; children join the same run/budget).

### 3.9 Worktree isolation + topo merge-back (LOAD-BEARING — consider a thin spike first)
This did not exist in the original plan; the grill surfaced that DAG semantics silently assume dependents build on their blockers' actual code:
- **Worktree per node** (uniform, all phases), created by the launch primitive; node commits on a per-node branch. (Per-task worktree pattern proven in #585 — pattern only, no code imports.)
- **Integration branch per run**: node done (postcondition green in its own worktree) → driver merges its branch into the run's integration branch, **topo order, serial merge queue**.
- **Post-merge re-check**: driver re-runs the check command on the integration branch after EVERY merge. Node checks parallelize; only landing serializes — trunk-CI semantics.
- **Blame rule: the landing node owns the breakage.** B merged green, C's merge turns integration red → C enters `integration_failed` (distinct from `failed`: fix is rebase-and-repair, not redo). C's corrective retry relaunches on a fresh worktree branched from CURRENT integration state with the failure diagnostics. C's dependents halt; B untouched. Merge conflict = same path.
- **Dependents branch from current integration state** at launch, not from run start.
- Run `done` = integration branch green and complete → **waits for human review/landing. Always. No auto-land** (owner decision).

### 3.10 Kill-all switch (owner requirement)
Besides per-run abort: a **global kill-all** operation — SIGKILL every live orchestrator subprocess across ALL runs, mark their headers `released`. One command, no per-run iteration.

---

## 4. Owner Decisions (2026-07-03, all locked)

| # | Decision | Value |
|---|---|---|
| 1 | Default autonomy | **`gated`** — manual-first; `auto` is per-run opt-in, refined later |
| 2 | Check-command enforcement | **Yes** — no check command → `auto` refused |
| 3 | Budgets | **max_total_runs 10**, max_depth 2, max_concurrent 3 |
| 4 | Timeouts | Generous: decompose **1h** / implement **4h** defaults, configurable |
| 5 | Landing | Integration branch **always waits for the human** |
| 6 | Abort | Cascade-archive ON + **global kill-all switch** |
| 7 | Retry escalation | **OFF in v1** — surface errors to the owner |

## 5. Success Criterion (testable)

A well-specified parent ticket completes an `auto` run with human touches ONLY at:
0. Authoring the parent ticket (spec quality is upstream of everything).
1. Choosing strategy + policy + check command at start.
2. Landing/rejecting the integration branch.
3. Responding to surfaced exceptions (`failed`, `integration_failed`, `budget_exceeded`, blocker notes).

Countable per run from recorded facts: human interventions ≡ exception surfaces + the two bookends.

**Recorded per run** (orchestrator-app models, no external deps): per-node attempts/retries, per-node + total wall time, exit codes, check pass/fail per node AND per merge, timeouts, budget consumed vs ceiling, strategy pack + policy used, token/cost from CLI JSON. A/B between packs yields mechanical verdicts on cost/time/retry-rate/pass-rate/decomposition-shape; artifact QUALITY is judged by the human at the landing gate they already occupy. (Benchmarking module #762 standardizes comparison later; nothing blocks on it.)

---

## 6. Ticket Graph (all in WorkTracker, project "Coding" `<redacted-id>`, module "Orchestrator" CODIN-780 `<redacted-id>`)

```
[1] Scaffold apps/orchestrator + pnpm orchestrate        <redacted-id>
 ├─→ [2a] Headless launch primitive                      <redacted-id>
 │     └─→ [2c] Worktree isolation + topo merge-back     <redacted-id>   ← LOAD-BEARING, spike candidate
 └─→ [2b] Strategy pack store + loader                   <redacted-id>
[2a]+[2b]+[2c] ─→ [3] Coordinator core (reducer+driver)  <redacted-id>
 ├─→ [4a] Run trigger surface (HTTP+MCP, abort/kill-all) <redacted-id>
 │     ├─→ [5] by-interface strategy pack                <redacted-id>
 │     └─→ [post-v1] Exit-and-supersede                  <redacted-id>
 └─→ [4b] Model/cost policy (phase,depth,attempt)        <redacted-id>
[3] ─→ [post-v1] Verifier-agent phase                    <redacted-id>
```

Slice scopes (full detail lives in each ticket's description; highlights):
- **[1] Scaffold**: app registered in settings, empty models, README with the import rule, `pnpm orchestrate` entry (signal seam live, no Studio/tmux), smoke test that the app loads + a signal receiver registers under that entry. Out: everything else.
- **[2a] Launch primitive**: contract `(agent, model, task_id, prompt, cwd) → run record`; raises on launch failure; own run-record model; non-interactive by construction; supervisor timeout; pid/transcript/usage capture; MCP config injection.
- **[2b] Strategy store**: pack dir format, loader, `default` pack (adapted from #700 recipe prose, rewritten for the fresh state model), hard error at run start on unknown pack/phase.
- **[2c] Worktree/merge-back**: everything in §3.9.
- **[3] Coordinator core**: everything in §3.1–3.8; single-parent run; fresh states only.
- **[4a] Trigger surface**: `POST /orchestrator/runs` (parent, strategy, policy; 409 if running), `GET` status, `DELETE` release; abort + cascade-archive; global kill-all; MCP tools = start TOP-LEVEL run (reject in-run callers) + read status; refuse auto without check command; only mounted under `pnpm orchestrate`.
- **[4b] Policy**: `(phase, depth, attempt) → (agent, model)`; defaults in pack, overridable per run; escalation off by default.
- **[5] by-interface pack**: split scope by interfaces (each division = one interface: contract, implementation, consumers; `blocked_by` = consumption order). ZERO code changes allowed — if code changes are needed, the store failed; fix the store. Acceptance: same parent run with `default` and `by-interface`, both complete, run headers record which pack produced which tree. Plus the deliberate partial-failure test (kill decompose mid-creation → reconcile retry completes the set → no duplicates).

---

## 7. Known Facts About the Environment

- Repo: `/path/to/repository`. Server: `server/` (Django+Ninja, venv at `server/.venv`, manage.py at `server/manage.py`), dev server runs on `localhost:8787`.
- Tracker app: `worktracker` (import as `from worktracker.models import Issue` — NOT `apps.worktracker`). Modules are `Issue` rows with `type="module"`; the generic `PATCH /work-items/{id}` 404s for module-type issues (use Django shell for module descriptions). Module-create endpoint accepts name only.
- Signal seam: `worktracker/signals.py` fires `issue_state_changed` on post_save via `transaction.on_commit` (rolled-back moves emit nothing).
- State groups: backlog/unstarted/started/completed/cancelled via `state_groups`. Cancel cascades to `is_archived` via BFS (#633) — reuse for abort.
- `blocked_by`: Issue↔Issue self-M2M with server-side cycle guard (#624).
- MCP server: `worktracker-stack/worktracker-agent/` (Python), tools are thin HTTP wrappers over the server — this indirection is load-bearing (writes must land in the server process for signals); do not "optimize" it away. Known MCP quirk: `create_task` drops the description — use `append_task_description`.
- Reference implementation (READ ONLY, never import): `server/apps/execution/{reducer,graph,state,driver,recipes,signals,api}.py` (~1,300 LOC), models `EngineRun`/`GraphRun`, design docs under `worktracker-stack/spec/worktracker--81c3aa9b/T700--*/BUILD-PLAYBOOK.html`.
- Per-task worktree pattern reference: #585 (git engine), merge-back on Done — pattern precedent for [2c].
- Repo conventions: succinct answers; HLD/LLD documents are interactive visual HTML matching the repository templates; worktracker-stack has an ownership governance model (read `worktracker-stack/CLAUDE.md` before touching that directory).

## 8. Residual Risks (from the grill verdict)

1. **[2c] worktree/merge-back carries the hardest unproven mechanics** (integration re-check queue, `integration_failed` rebase-and-repair, branch-from-current-integration). Spike before committing if anything.
2. **Deterministic-slug discipline is a convention, not a mechanism** — the structural gate catches most violations; validate early with the deliberate partial-failure test.
3. **Quadrant-3 tension**: the system will sometimes advance work the agent believed had failed. Acceptable with driver-run checks; keep the anomaly flag loud in run status.

## 9. Build Order Recommendation

1. Scaffold [1] — small, unblocks everything.
2. Spike [2c]'s merge-back mechanics (throwaway) in parallel with [2a]/[2b].
3. [2c] properly, then [3], then [4a]/[4b], then [5] as the end-to-end acceptance.
