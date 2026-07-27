# ADR-0002 (T811): policy.py stays pure — the headless agent set is threaded as a parameter, never read from the registry inside policy

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-811 refinement)

## Context

`policy.py:165` hardcodes `("codex", "claude")` inside `_choice()`, a pure
validator with three callers: `loader.py:182` (pack load), `driver.py:108`, and
`service.py:79`. The ticket said "L165 → `port.headless_agents()`" without
saying how the port reaches a module whose docstring promises "policies are
pure data". Calling the registry inside `_choice` would make pack loading and
every policy unit test depend on process-global binding state.

## Decision

- `normalize_policy` / `merge_policy` grow a keyword-only
  `allowed_agents: frozenset[str]` parameter, threaded down to `_choice`.
- The three call sites fetch the set themselves via
  `apps.core.session_registry.get_headless(...).headless_agents()` — an import
  the orchestrator is already allowed (precedent: `driver.py`,
  `test_interactive_launch.py`).
- `test_policy.py` passes the set explicitly and needs no bound port; the new
  fake-port tests cover the "policy respects `headless_agents()`" acceptance
  through a caller.

## Alternatives rejected

- **Registry call inside `_choice`**: fewer touched call sites, but policy.py
  gains hidden global state, and pack-pack loading in a process without
  terminals bound would crash on an unrelated concern.
- **Keep L165 hardcoded**: leaves the agent set duplicated on both sides of the
  seam — the exact drift the parent story (CODIN-808) exists to delete.
- **Defaulted parameter (`allowed_agents=frozenset({"codex","claude"})`)**: a
  silent fallback that reintroduces the hardcode behind a kwarg.

## Consequences

- In the orchestrate profile `apps.terminals` is installed (CODIN-798), so the
  binding exists wherever packs load; orchestrator tests get the set from the
  autouse fake-port conftest fixture.
- The interactive-launch agent (`driver.py:843`, fixed `"claude"` per the
  CODIN-798 grill decision) is untouched: the model policy's agent/model
  applies to headless CLIs only, which is exactly why `headless_agents()` is
  the right semantic for this validation.
