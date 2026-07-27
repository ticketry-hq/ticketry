# ST6 — Strategy extraction: the fold moves out of the engine, the grammar dies

**Depends on:** ST5.
**Read first:** `INTERFACES.md` §3 (reducer), §6 (loader — REQUIRED_PHASES, pack.toml shape), §2 (state types); `../ADR-0001…`, `../ADR-0002…`; `server/apps/orchestrator/strategy.py` (a Strategy protocol already exists — read the whole file before writing anything) and `tests/test_strategy.py`.

**STEP 0 — verify:**
`grep -n "REQUIRED_PHASES\|OPTIONAL_PHASES" server/apps/orchestrator/loader.py`
`grep -n "class Strategy\|def decide" server/apps/orchestrator/strategy.py server/apps/orchestrator/reducer.py`
`grep -n "from apps.orchestrator.reducer import decide\|decide(state" server/apps/orchestrator/driver.py`

## Goal

After this subtask, a new run style is a new Strategy class named in a pack manifest —
zero engine edits. The engine calls `strategy.decide(state, event)`; it no longer imports
`reducer.decide` directly, and the loader no longer enforces a fixed phase grammar.

## Step 1: `server/apps/orchestrator/default_strategy.py` (new)

```python
from apps.orchestrator import reducer
from apps.orchestrator.state import Decision, Event, RunState

class DefaultStrategy:
    """decompose→implement(→verify) — the v1 flow, now pack-owned (ADR-0001)."""
    name = "default"
    def decide(self, state: RunState, event: Event) -> Decision:
        return reducer.decide(state, event)
```

`reducer.py` is NOT moved or edited — it becomes this strategy's implementation detail.
Make sure `DefaultStrategy` satisfies the existing protocol in `strategy.py` (adjust the
class to the protocol, never the protocol to the class; if the protocol has extra members,
implement them minimally and mirror what `StrategyPack.strategy()` currently returns).

## Step 2: manifest-driven strategy resolution in `loader.py`

- pack.toml gains an optional key: `strategy = "apps.orchestrator.default_strategy:DefaultStrategy"` (module path, colon, class name). Default when absent: exactly that value.
- `StrategyPack` gains field `strategy_ref: str` and its `strategy()` method resolves it: `importlib.import_module(mod)`, `getattr(cls)`, instantiate, cache on the pack instance. Wrap import/attr errors in the loader's existing `StrategyError` with a message naming the bad ref.
- **Delete the grammar**: remove `REQUIRED_PHASES`/`OPTIONAL_PHASES` and the checks that reject packs missing decompose/implement or declaring other phases. Keep: every phase listed in the manifest `phases` must have a `<phase>.md` template, and the interpolation whitelist stays exactly as is.
- Update both shipped manifests (`strategies/default/pack.toml`, `strategies/by-interface/pack.toml`) to declare the strategy key explicitly.

## Step 3: the engine calls the pack's strategy

In `driver.fold` (INTERFACES.md §4): replace the direct `decide(state, event)` call with

```python
pack = load_pack(header.strategy)          # already loaded nearby for _verify_enabled — reuse, don't double-load
decision = pack.strategy().decide(state, event)
```

Remove the now-unused `from apps.orchestrator.reducer import decide` import from driver.py.
`load_pack` failures here should surface exactly like current pack errors in the launch
path (grep how `_default_launch` handles `StrategyError` and mirror it).

## Step 4: tests

- Existing `test_reducer.py` must pass **unchanged** (reducer is untouched).
- `test_strategies.py`: update the manifest-validation tests — packs missing `implement` no longer error; a pack declaring `phases = ["plan", "build"]` with matching .md files loads fine. A bad `strategy` ref raises `StrategyError` naming the ref.
- New `test_custom_strategy.py`: the toy strategy must live in a real importable module — create `server/apps/orchestrator/tests/toy_strategy.py` containing `class HaltEverything` whose `decide` returns `Decision(next=replace(state, status="done"))`, and reference it from the tmp pack manifest as `strategy = "apps.orchestrator.tests.toy_strategy:HaltEverything"` (importlib cannot import a class defined inside a test function). Build the tmp pack dir by copying the tmp-pack fixture pattern from `test_strategies.py`; create a run with that strategy name; call `driver.fold(run_id, Event(kind="tick"))` with the pack root patched (grep how existing tests patch `load_pack`'s root or monkeypatch `load_pack`) and assert the run header goes `done` — proving the engine executed pack-supplied code with zero engine edits.
- `test_strategy.py` (protocol test): `DefaultStrategy` passes it.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator -q
grep -n "REQUIRED_PHASES" server/apps/orchestrator/loader.py    # no hits
grep -n "from apps.orchestrator.reducer" server/apps/orchestrator/driver.py   # no hits
```

## Out of scope / do not touch

- Do not edit reducer.py at all.
- Do not move prompt templates; packs keep their .md files.
- The Executor invariants stay in the engine: `_apply_budget_brake`, `max_total_runs`, `max_depth`, one-active-run-per-root (see SPEC "Invariants") — a Strategy cannot raise them.
- No policy.py changes.
