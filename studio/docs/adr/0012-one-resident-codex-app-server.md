# One resident Codex app-server handles thread-title reads

Ticketry reads Codex thread names through one `codex app-server` child owned by
the Rust GraphQL service. A child peaks near 80 MB and answers a read in under
one second. Spawning one child per read would multiply that memory cost when
several conversations refresh together. One resident child keeps the cost
bounded, stays alive with the service, and restarts after it exits.

This connection is read-only. Ticketry sends only `initialize` and
`thread/read` with `includeTurns: false`. It never sends `thread/start` or
`thread/resume`, so the tmux-hosted Codex CLI keeps control of the conversation.

Title reads are cosmetic. A missing executable, unavailable or restarting
child, timeout, protocol error, malformed reply, missing name, or empty name
does not replace the title Ticketry already has.

Codex initially names a thread from the opening message. For Ticketry launches,
that text begins with private prompt boilerplate. Rust therefore normalizes
whitespace and accepts a non-empty `thread.name` only when it is not a prefix
of the run's launch prompt. `thread.preview` is ignored. This keeps the safe
launch title until Codex supplies a real name.

## Considered options

- Starting one app-server per read was rejected because concurrent refreshes
  would multiply the measured 80 MB process cost.
- Starting or resuming threads on the resident connection was rejected because
  title lookup must not take a conversation away from its interactive CLI.
