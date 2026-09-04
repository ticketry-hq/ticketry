# One resident Codex app-server owned by the Rust service

Ticketry needs the user-facing name of a Codex thread to title an Instant
ticket. Codex keeps that name in its own on-disk state, and the only supported
way to read it is the `codex app-server` JSON-RPC protocol. Codex itself runs
inside tmux as the interactive CLI, so Ticketry never opens threads through the
app-server; it only reads them.

We considered spawning a short-lived app-server for each read. One read costs
about 80 MB of peak memory and under a second, so the per-read shape works, but
several conversations refreshing at once would run several 80 MB processes side
by side. We decided instead that the Rust GraphQL service starts one
`codex app-server` child when it starts, keeps it alive for the life of the
service, restarts it if it exits, and routes every thread read through it. The
child is a read-only peer: Ticketry never calls `thread/start` or
`thread/resume` on it, so it never takes ownership of a conversation away from
the tmux-hosted CLI.

The trade-off is a permanently resident process of roughly 80 MB on machines
where Codex is installed, plus restart supervision, in exchange for bounded
memory under load and one connection that later work can subscribe through for
thread notifications. When Codex is not installed the child is never started
and every read reports the title Ticketry already has.
