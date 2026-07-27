# ADR-0003 (T810): The injector tests embedded in the four hook test files move verbatim to `tests/test_injectors.py`

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-810 refinement)

## Context

The ticket deletes `test_{claude,codex,gemini,agy}_hook.py` wholesale, but
each file also contains **injector** tests that are not hook-contract
coverage: `test_inject_settings_for_*`,
`test_build_settings_wires_events_and_identity`,
`test_inject_settings_leaves_other_agents_untouched` (~10 tests asserting TOML
serialization, argv splice order, temp-settings-file contents, MCP
injection). T809's ADR-0001 explicitly punts this cleanup to S2 ("cleanup
rides S2"), and CODIN-809's new `test_agent_registry.py` covers injection only
*through the chain*, not these unit-level shapes.

## Decision

- S2 moves the injector tests **verbatim** (per-agent, not force-parametrized
  — the injectors differ genuinely) into a new
  `server/apps/terminals/tests/test_injectors.py`, in the same commit that
  deletes the four hook test files. No coverage gap at any point.
- S2 stays **independent of S1 (CODIN-809)**: if S1 has landed, the overlap
  with `test_agent_registry.py`'s through-the-chain assertions is acceptable
  duplication; unit-level shape assertions and chain assertions answer
  different questions. Later slices may reorganize.

## Consequences

- The ticket's "net LOC drops by roughly 1,100" acceptance figure was
  computed assuming the injector tests die; with ~250 lines preserved the
  honest figure is **roughly 900–1,000** net lines removed.
