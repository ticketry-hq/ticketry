# ADR-0001 (T800): Orchestrator reaches Session by injection, not import

Date: 2026-07-05 · Status: Superseded by CODING-294 / CODING-302 (2026-08-09)

## Supersession

The legacy `Session` port and adapter are retired. Application launch services
own launch policy and consume the public `apps.terminals.runtime` contract for
terminal mechanics. The orchestrator's zero-import boundary remains in force;
it does not require a terminal-owned Session abstraction.

## Decision

`apps.orchestrator` keeps **zero** imports of `apps.terminals` (and `apps.execution` /
`apps.runs`). The new deep `Session` module lives in `apps.terminals`; the
orchestrator consumes it through a locally-declared port (a `typing.Protocol`
or injected callables, mirroring the existing `SpawnRun` seam in
`apps/execution/driver.py:22`). The real terminals adapter is bound at a
composition root **outside** the AST-checked `apps/orchestrator/` tree.

`orchestrator/tests/test_scaffold.py` is **not narrowed** — the forbidden list
(`apps.execution`, `apps.terminals`, `apps.runs`) stays exactly as-is. This
supersedes the "narrow the scaffold test" boundary sketch in the CODIN-800
ticket draft.

## Alternatives rejected

- **A — narrow the scaffold test** to permit one `apps.terminals.session`
  import: shortest path for #798, but permanently widens the orchestrator's
  import surface and forces amending test_scaffold + orchestrator README +
  T780 brief §2.5 ("must never import from `apps.terminals`").
- **C — route via `apps.execution`**: keeps terminals invisible above
  execution, but turns execution into a pass-through module for interactive
  launch semantics (#798's `launch_mode`, completion, teardown) — a shallow
  module by construction.

## Consequences

- Session's interface must be expressible as a small Protocol the orchestrator
  can restate without importing terminals types (plain params / small
  dataclasses defined orchestrator-side, ids as `str`).
- Two adapters exist from day one — the real tmux-backed Session and the
  in-memory fake used by orchestrator/execution tests — so the seam is real,
  not hypothetical.
- The wiring point (who instantiates the real adapter and hands it to the
  orchestrator driver) must live outside `apps/orchestrator/` — mechanism
  decided separately (see grill notes / ticket).
