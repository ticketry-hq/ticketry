# One durable substrate: agents outlive the server, report Facts; the server reconciles

Headless and interactive agents run on the same substrate: detached sessions (tmux via the terminals Session module) that survive server restarts. A headless run is a Session no human attaches to. The server owns no agent process — it is a stateless state recorder: it kicks off detached agents and folds durable Facts. Because detached processes cannot be waited on, completion is collected by a sidecar: a thin wrapper process is the agent's parent inside the Session (so exit code and output are collected via waitpid, not requested via prompt) and writes exit/completion Facts durably (never lost if the server is down), agent hooks and ticket transitions act as reconcile pokes, and a periodic reconcile tick provides liveness — pid checks, timeout enforcement, orphan sweeps. We rejected keeping headless agents as supervised child processes (the asyncio supervisor dies on ASGI reload — bug #814's whole class) and rejected hooks as the sole reporters (a lost hook strands a run in "running" forever).

## Consequences

- Run progression has up to tick-interval latency when a poke is lost; the tick is the guarantee, pokes are the optimization.
- Exit-code and output/verdict capture move out of the server into the wrapper around the agent process.
- Timeouts are enforced by reconcile comparing durable timestamps, not by resident timers.
