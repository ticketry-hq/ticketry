# One resident Codex app-server owned by the Rust service

Ticketry needs the user-facing name of a Codex thread to title an Instant
ticket, and it needs to set that name when a caller renames the thread through
the MCP listener. Codex keeps the name in its own on-disk state, and the only
supported way to read or write it is the `codex app-server` JSON-RPC protocol.
Codex itself runs inside tmux as the interactive CLI, so Ticketry never opens
threads through the app-server; it only names them.

We considered spawning a short-lived app-server for each read. One read costs
about 80 MB of peak memory and under a second, so the per-read shape works, but
several conversations refreshing at once would run several 80 MB processes side
by side. We decided instead that the Rust GraphQL service starts one
`codex app-server` child when it starts, keeps it alive for the life of the
service, restarts it if it exits, and routes every thread request through it.
Exactly two methods are allowed on that child, `thread/read` and
`thread/name/set`. Ticketry never calls `thread/start`, `thread/resume`, a
fork, or any other thread-ownership method, so it never takes ownership of a
conversation away from the tmux-hosted CLI. A rename shares the same
connection, mutex, request ids, timeout, and restart policy as a read, so the
write cannot introduce a second process.

The trade-off is a permanently resident process of roughly 80 MB on machines
where Codex is installed, plus restart supervision, in exchange for bounded
memory under load and one connection that later work can subscribe through for
thread notifications. When Codex is not installed the child is never started:
every read reports the title Ticketry already has, and every rename reports the
capability unavailable.
