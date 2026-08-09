# ADR-0005 (T800): Drop the WS direct-PTY fallback

Date: 2026-07-05 · Status: Accepted; amended by CODING-294 / CODING-302 (2026-08-09)

## Amendment

The tmux-mandatory decision remains accepted. The retired Session facade no
longer owns launch policy: the application launch service prepares and records
the run, then calls the public terminal runtime. The WebSocket adapter attaches
through that runtime and still has no direct-PTY fallback.

Closes the open question flagged against review Candidate 2 ("does the WS
bare-PTY fallback survive, and on which side of the seam?").

## Decision

The WebSocket consumer's tmux-less **direct-PTY fallback is removed**. When
tmux/launch is unavailable, `spawn` fails loud (surfaces `LaunchUnavailable`
through the Session interface); the consumer reports the error and closes
rather than spawning a bare PTY it cannot track.

## Rationale

- The fallback produced a session with **no `AgentRun` row, no tmux name, no
  watcher** — invisible to `live_run_for`, `reconcile`, teardown, and the
  orchestrator. It directly contradicts ADR-0003 (Session is the sole writer of
  run-status truth): a fallback PTY is a live agent the status invariant cannot
  see.
- It was the second launch implementation ADR-0002 / Candidate 2 collapse. Keeping
  it behind the seam would re-introduce the divergence the single door removes;
  keeping it in front of the seam would let the consumer bypass the door.
- tmux is a hard dependency of the product already (every tracked run is a `pt-`
  session); a missing tmux is an environment failure worth surfacing, not
  papering over.

## Consequences

- `spawn` has one failure mode surfaced uniformly: `LaunchUnavailable`. The WS
  consumer maps it to an existing close code (`1011 spawn_failed`).
- Removes the only spawn path that produced an untracked session — every live
  agent now has a row and is reconcilable.
- Slightly less resilient in a broken-tmux dev environment; acceptable, and
  loud-failure makes the misconfiguration obvious.
