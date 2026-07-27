# Strategy is a deterministic fold; no Temporal

A Strategy is authored as a deterministic fold — `decide(run_state, fact) → [Activity]` — not as imperative await-style workflow code. Durability comes from re-folding durable Facts on every reconcile, so a restart re-derives any in-flight decision instead of resuming a Python frame. We rejected adopting Temporal (the freedom-agents approach): its imperative authoring ergonomics are bought with a second runtime on a single box, and it fits recursive fan-out and tmux-bound interactive sessions poorly. We also rejected homegrown replay of imperative code as building a worse Temporal, where determinism bugs become silent state corruption.

## Consequences

- Strategy authors write a state machine over a fixed Activity vocabulary, not a script. This is deliberate: a closed set of known actions is what makes strategies comparable, experimentable, and eventually machine-searchable.
- The existing reducer shape (pure `decide()`) is the authoring template; it moves from engine-owned to Strategy-owned.
- The Executor guarantees: every externally-caused occurrence lands as a durable Fact, and reconcile is idempotent. Nothing else may carry run-progress state.
