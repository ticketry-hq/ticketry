# Executor refactor — binding spec

Outcome of the 2026-07-06 design grilling. This spec is binding for the orchestrator
refactor; the reasoning lives in `docs/adr/0001..0004` and the vocabulary in
`../CONTEXT.md`. Use the glossary terms exactly.

## The decided shape

Three modules, two seams:

```
Strategy (authored code, per run style)
   │  decide(run_state, fact) → [Activity]        ← seam 1: Activity vocabulary
Executor (the reusable product)
   │  ManagedAgent.start(AgentConfig) / reconcile()
   │  persists Facts + run rows; owns no agent process
   │  Session substrate (terminals #800)           ← seam 2: SessionPort (exists)
Sidecar + detached agent (tmux Session, survives server restarts)
```

1. **Strategy is authored code, as a deterministic fold** (ADR-0001, ADR-0002).
   `decide(run_state, fact) → [Activity]` — the exact shape of today's
   `reducer.decide()`, relocated from engine-owned to Strategy-owned. No
   imperative/await coordination code; no Temporal. The current
   decompose→implement→verify flow becomes `strategies/default/strategy.py`,
   the first Strategy authored against the library — not a grammar the loader
   enforces. `loader.py`'s `REQUIRED_PHASES`/`OPTIONAL_PHASES` and pack-shape
   validation are deleted; packs keep prompts, owned by their Strategy.

2. **The Executor is the reusable product** (ADR-0001, ADR-0003). It runs
   Activities, records Facts durably, reconciles. It owns **no run-shape
   decisions** and **no agent processes**. The server is a stateless state
   recorder: restart is a non-event.

3. **ManagedAgent is the atomic piece** (CONTEXT.md, ADR-0003). One surface for
   every agent CLI and both modes:
   - `start(AgentConfig) → durable AgentRun row + detached Session` — never
     call-and-await; results arrive later as Facts.
   - `stop(handle)`
   - `reconcile() → [Fact]` — pid liveness, timeout expiry (durable timestamps,
     no resident timers), completion collection.
   `AgentConfig` declares: CLI, model, workdir, brief/prompt, mode
   (headless/interactive+gated), timeout, and the **completion contract** — a
   composable set of checks from a small library (ticket-transitioned,
   commits-on-branch, file-matches-schema). ManagedAgent verifies the declared
   checks at collection time and emits verified Facts; Strategies fold over
   conclusions and never re-verify. (This relocates `driver._build_node_exited`
   postcondition logic into the component.)

4. **Sidecar owns the agent process** (ADR-0003). Every run — headless is a
   Session no one attaches to — launches as `Session.spawn(sidecar <agent cmd>)`.
   The sidecar is the agent's parent: collects exit code and stdout/verdict via
   waitpid (never via prompt-compliance), writes completion Facts durably even
   if the server is down. Hooks and ticket transitions remain as reconcile
   *pokes* — latency optimizations, never the source of truth. A periodic
   reconcile tick (~30s) is the liveness guarantee: pid checks, timeouts,
   orphan sweeps. Accepted cost: up to tick-interval staleness when a poke is
   lost.

5. **Interactive = attachable; completion ≠ exit** (ADR-0004). Same atom, same
   substrate; differences are config only. `ContractMet` may arrive before or
   without `Exited`; Strategies fold on `ContractMet`, `Exited` is cleanup
   information. Attachers (human now, overseer LLM later — CODIN-818) are
   consumers of the attach surface and require zero Executor changes.

## Fact vocabulary (seam 1 input alphabet)

Durable rows, append-only, drained by reconcile:
`Started · Exited(code, timed_out) · ContractMet(checks) · ContractFailed(checks, detail)
· TicketTransitioned · TicketCancelled · VerdictLanded(verdict, findings)
· QuestionAsked / QuestionAnswered (#791, schema-reserved)`

Activity vocabulary (seam 1 output): `LaunchAgent(AgentConfig) · StopAgent ·
ArchiveSubtree · CompleteRun` — extend only with Executor-implementable,
strategy-agnostic operations.

## Invariants that stay in the Executor (packs/Strategies cannot override)

- Machine-protection budgets: max concurrent agents, `max_total_runs`,
  `max_depth` hard caps (a Strategy may set lower, never higher).
- Every externally-caused occurrence lands as a durable Fact; reconcile is
  idempotent; nothing else carries run-progress state (ADR-0002).
- One active run per root ticket.

Everything else the old engine hardcoded — retry counts, two-signal done
semantics, verify gating, cancel-as-impossible handling (#796), exit-and-
supersede — moves into the default Strategy's fold, expressed over verified
Facts.

## What dissolves

- `headless.py`: loop registration, `_fallback_loop`, `schedule_coroutine`,
  `_supervise_process`, on_commit launch scheduling — replaced by
  Session+sidecar spawn and reconcile. Command construction and verdict/stdout
  handling move into sidecar + contract checks.
- `driver.py`: fold orchestration shrinks to the generic reconcile; launch
  prompt shaping and postcondition evaluation move to ManagedAgent/contracts;
  adoption ("resume_supervision") ceases to be a special path — recovery *is*
  reconcile.
- `loader.py`: phase grammar and pack validation; keep prompt loading +
  interpolation whitelist.
- `reducer.py`: relocates to `strategies/default/` as the first authored
  Strategy, minus what moved into contracts.
- `startup.py`: shrinks to "run reconcile once + ensure tick".

## Migration order (each step green before the next)

1. Sidecar + `AgentConfig`/`ManagedAgent.start/reconcile` for headless runs
   (tmux-hosted, wrapper-collected exit) behind the existing driver — proves
   substrate + collection without touching strategy logic.
2. Durable Fact inbox + reconcile tick; delete on_commit scheduling, fallback
   loop, and resident supervision; `startup.py` becomes reconcile-once.
   (Kills #814's orphan class.)
3. Contract-check library; move `_build_node_exited` postconditions into
   ManagedAgent; Facts become verified.
4. Extract `reducer.decide()` into `strategies/default/strategy.py`; delete
   loader grammar; Executor becomes strategy-agnostic.
5. Interactive runs onto the same path (`ContractMet` before `Exited`; #798
   Done-gate becomes the normal rule, not a special case).

## Out of scope

- Overseer LLM attacher — CODIN-818.
- Question surface Facts implementation — CODIN-791 (schema reserved here).
- Worktree/commit-gate content of the implement contract — CODIN-788 defines
  the check; this spec only gives it a home (contract library).
