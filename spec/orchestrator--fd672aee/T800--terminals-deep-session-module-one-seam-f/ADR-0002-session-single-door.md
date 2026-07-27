# ADR-0002 (T800): Session is the single door — lifecycle + attach handle

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-800 refinement)

## Decision

The Session module's interface is **lifecycle + attach handle**, and it is the
ONLY way any code outside `apps.terminals` (and any code inside it other than
the Session implementation) touches terminals/tmux:

- `spawn(intent) -> agent_run_id` — headless by design; no viewer implied.
- `terminate(agent_run_id)` — idempotent teardown.
- `live_run_for(task_id)` / `sessions_for(task_id)` — liveness/enumeration.
- `attach(agent_run_id) -> AttachHandle` — claims the single viewer slot and
  exposes the viewer operations (attach recipe/argv, scroll, resize) with
  release-on-close owned by the handle, so callers cannot forget the release.

Everything else — tmux commands, session names (`pt-*`), viewer slot
reserve/release, `AgentTerminalSession` rows, watcher start/stop, per-agent
lifecycle hooks — is implementation detail. No module outside Session imports
`apps.terminals.tmux` or calls these primitives directly. The same provider
contract is universal across all callers: WS consumer, REST router,
execution driver, orchestrator (injected per [ADR-0001](ADR-0001-session-seam-placement.md)).

## Why spawn and attach are separate

Spawn is per-run; attach is per-viewer. Runs execute headless in detached tmux
(surviving WS disconnects and backend restarts); byte proxying exists only
while a viewer is attached, and a run may be attached to hours later, or never.
The WebSocket itself and the byte pump remain in the WS consumer — only the
tmux knowledge moves behind the interface.

## Consequences

- The tmux package's re-export shrinks to internal use (ticket deepening #4
  stops being speculative — it follows mechanically).
- The one-viewer-at-a-time invariant is enforced inside AttachHandle, not by
  caller discipline.
- Needs an enforcement mechanism (import-boundary test, mirroring the
  orchestrator scaffold test) so "nobody calls tmux directly" stays true.
