# ST7 — Interactive unification: one atom, attach is just config

**Depends on:** ST5 (reconcile switch-over). Do after ST6 to avoid merge conflicts in driver.py.
**Read first:** `INTERFACES.md` §4 (`_launch_interactive`), §11 (SessionPort), §12 (TerminalSessionService, agent_run_id); `../ADR-0004…` (completion ≠ exit); `tests/test_interactive_launch.py` (the current expected behavior — preserve it).

**STEP 0 — verify:**
`grep -n "_launch_interactive\|get_session()" server/apps/orchestrator/driver.py`
`grep -n "def spawn" server/apps/orchestrator/ports.py`
`grep -n "node_transitioned\|node_cancelled" server/apps/orchestrator/signals.py`

## Goal

Interactive launches go through the same `ManagedAgent.start(config)` surface as headless
— mode is config, not a different world. Behavior must not change: gated semantics, the
#798 Done-gate (a running interactive node completes on ticket transition — that IS
ADR-0004's `ContractMet` before `Exited`), and cancel teardown all stay.

## Step 1: `managed_agent.start` grows the interactive branch

Replace the `NotImplementedError` from ST4:

```python
if config.mode == "interactive":
    from apps.core.session_registry import get_session
    agent_run_id = async_to_sync_or_loop_safe( get_session().spawn(
        agent=config.agent, project_id=config.project_id, module_id=config.module_id,
        task_id=config.task_id, initial_prompt=config.prompt,
    ) )
    return agent_run_id
```

Notes for the implementer:
- `SessionPort.spawn` is `async` (ports.py) and today is awaited from `driver._launch_interactive` — read how the current call site bridges async (INTERFACES.md §4, driver.py L816-887) and reuse that exact bridging. Do not invent a new one.
- Interactive creates **no HeadlessRun row** today; keep that. Return type: change `start` to `-> HeadlessRun | str` is ugly — instead add a small frozen `StartResult(kind: Literal["headless","interactive"], headless_run: HeadlessRun | None, agent_run_id: str | None)` and return it from both branches; fix ST4's callers/tests mechanically (they only unpack the row).
- Spawn failure: mirror the current `_launch_interactive` failure fold (`Event(kind="node_exited", ...)` — see driver.py) by raising; the caller (Step 2) folds, matching today's behavior.

## Step 2: `driver._launch_interactive` shrinks to a shim

Its body becomes: build the same prompt it builds today, call
`managed_agent.start(AgentConfig(mode="interactive", agent=..., task_id=action.node_id, prompt=prompt, cwd=<repo root as today>, project_id=str(issue.project_id), module_id=dao.get_module_id_for(issue), contract=("ticket_transitioned",)))`,
then on success `dao.update_run_node_agent_run_id(run_id, action.node_id, result.agent_run_id)`,
on failure fold the same failure event as today. All session-registry imports leave driver.py
(`grep -n "session_registry" server/apps/orchestrator/driver.py` must end with zero hits).

## Step 3: reconcile touches interactive sessions

In `reconcile.reconcile()` (ST5), after the headless pass, add: for each **active** run in
`launch_mode="interactive"` — nothing to collect (completion arrives via `signals.py`
ticket-transition folds, which stay untouched), but stale-session hygiene runs:
call `get_session().reconcile()` if the bound port exposes it (feature-detect with
`getattr(port, "reconcile", None)`; the Protocol only guarantees spawn/terminate —
do NOT add it to ports.py in this subtask). Wrap in try/except + log.

## Step 4: name the Done-gate as the rule

In `reducer.py`'s node-transition handler there is a comment/branch implementing the #798
Done-gate for running interactive nodes (grep `node_transitioned` in reducer.py). Do not
change the logic; update the comment to reference ADR-0004: completion (`ContractMet`,
here the ticket transition) legitimately precedes process exit for interactive sessions —
this is the model, not a workaround. Yes, this step is comment-only.

## Step 5: tests

- `tests/test_interactive_launch.py` must pass with minimal mechanical adaptation (the fake SessionPort moves its assertion point from `driver._launch_interactive` internals to `managed_agent.start` — same spawn kwargs asserted).
- Add to `test_managed_agent.py`:
  1. `test_interactive_start_spawns_session` — fake SessionPort bound via `apps.core.session_registry.bind` (copy the fixture from test_interactive_launch.py); assert spawn kwargs and returned `agent_run_id` in `StartResult`.
  2. `test_interactive_start_no_headless_row` — HeadlessRun count unchanged by an interactive start.
  3. `test_interactive_spawn_failure_raises` — fake port whose spawn raises → `start` propagates; then assert (at the driver level, copying the existing failure-fold test) the node folds to failed exactly as before.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator -q
grep -n "session_registry" server/apps/orchestrator/driver.py   # no hits
```

## Out of scope / do not touch

- signals.py logic unchanged (comment updates allowed).
- No Question/hold implementation (CODIN-791), no overseer (CODIN-818).
- ports.py Protocol unchanged.
- Gated/autonomy validation in commands.py (ex-service.py) unchanged.
