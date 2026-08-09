# ADR-0004 (T800): Wire the real Session adapter via a neutral AppConfig registry

Date: 2026-07-05 · Status: Superseded by CODING-294 / CODING-302 (2026-08-09)

## Supersession

The Session adapter and neutral Session registry are removed. Application
services depend directly on the public `TerminalRuntime` protocol and own their
composition/test seams without exposing provider, persistence, or lifecycle
policy to the terminal runtime.

Resolves the wiring mechanism left open by ADR-0001 ("who instantiates the real
adapter and hands it to the orchestrator driver — mechanism decided separately").

## Decision

A neutral registry module holds the bound `SessionPort`; `apps.terminals` binds
its real adapter at startup; the orchestrator reads the port through the
registry. No orchestrator → terminals import is introduced.

- **Neutral registry** (e.g. `apps/core/session_registry.py`) importing neither
  orchestrator nor terminals: `bind(port)` / `get_session() -> SessionPort`.
- **Terminals binds on startup**: `apps.terminals`'s `AppConfig.ready()` imports
  its own `session` module and calls `session_registry.bind(TmuxSession())`.
- **Orchestrator reads**: `apps/orchestrator/driver.py` calls
  `session_registry.get_session().spawn(intent)` — the registry is neutral, so
  the AST-checked forbidden list (`apps.execution`, `apps.terminals`,
  `apps.runs`) stays satisfied (ADR-0001).
- **Tests bind the fake**: `session_registry.bind(FakeSession())` in setup — the
  second adapter ADR-0001 requires, giving a real seam.

## Alternatives rejected

- **settings `import_string`**: `ORCH_SESSION_ADAPTER = "apps.terminals..."`
  resolved at call time. Passes the AST test (runtime string, not an import) and
  is the least code, but pushes a load-bearing dependency into stringly-typed
  settings and reads as configuration rather than a declared seam.
- **Composition-root parameter injection** (thread `session=` from
  `start_run` → services → driver, default `None`): closest to the existing
  `SpawnRun` seam precedent, but threads the port through every call site and
  every intermediate signature — sprawl for a dependency that is process-global
  in practice.

## Consequences

- The registry is process-global mutable state; binding happens once at
  `AppConfig.ready()`. Tests must rebind (and restore) the fake around cases.
- `get_session()` on an unbound registry must fail loud (raise), not return
  `None` silently — an unbound Session is a deployment error, not a runtime
  branch.
- The `SessionPort` Protocol is declared orchestrator-side (per ADR-0001); the
  registry's type is that Protocol, kept import-free of terminals concretes.
- The composition root is "terminals' own `AppConfig.ready()`", which keeps the
  binding adjacent to the adapter it constructs — no separate wiring module to
  keep in sync.
