# Shell runs reuse the AgentRun record

Studio's terminal panel needs durable, tmux-backed shells that have no agent,
no prompt and no lifecycle hooks. Rather than introduce a parallel session
concept, a shell is recorded as an `AgentRun` with `scope="shell"` and a null
`agent`, hanging off the module's own Issue row exactly as taskless scratch
runs already do. The tmux runtime, the `pt-{id}` session naming, the WebSocket
consumer, the viewer lease and the native attach path all treat the run id as
an opaque string, so all five are reused unchanged; the only schema change is
making `agent` nullable.

## Considered Options

A parallel non-agent session concept with its own table and identity was the
obvious alternative, and was initially recommended on the grounds that a
non-run would otherwise leak into every run-counting surface. That turned out
to be false on inspection: the scratch chicklet selectors already filter to
`plan`/`instant` scopes, task rollups match real task ids while a shell carries
`SCRATCH_TASK_ID`, and the module activity badge counts only runs carrying a
lifecycle state — which arrives from agent hooks a shell does not have. With no
exclusion filters actually required, a parallel concept bought nothing and cost
a second identity threaded through persistence, reconciliation, the lease and
the transport.

T3 Code's model — ephemeral server-owned PTYs whose *transcript* is persisted to
a capped file and replayed on attach — was also considered and rejected as
strictly weaker than the tmux durability this codebase already has, and as a
second terminal runtime beside the one `TerminalRuntime` is documented to be.

## Consequences

`AgentRun` no longer means "a run of an agent", and `agent` being null is now a
valid state that every reader must handle. The glossary deliberately does *not*
paper over this with an umbrella term: `Agent run` and `Shell run` are two terms
sharing one record, so the divergence between the code's spelling and the
domain's vocabulary is explicit rather than hidden.

Ending a shell run publishes `agent_run_terminated` like any run. This is a
verified no-op — `execution.driver.observe_agent_run_terminated` filters
`LaunchedTask` by run id and returns early when there are no rows, and a shell
is never a `LaunchedTask` — but it is a real coupling that a parallel concept
would not have had, and any future subscriber to that seam must tolerate runs
that no campaign scheduled.
