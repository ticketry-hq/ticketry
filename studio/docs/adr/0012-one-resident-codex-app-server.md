# One resident Codex app-server handles thread-title reads and renames

Ticketry reads Codex thread names through one `codex app-server` child owned by
the Rust GraphQL service. A child peaks near 80 MB and answers a read in under
one second. Spawning one child per read would multiply that memory cost when
several conversations refresh together. One resident child keeps the cost
bounded, stays alive with the service, and restarts after it exits.

Ticketry sends only `initialize`, `thread/read` with `includeTurns: false`, and
`thread/name/set` through the registered `rename_codex_thread(thread_id, name)`
MCP capability. Reads and renames share the same resident client. The rename
targets an existing concrete Codex thread and writes no Ticketry row, including
the manual `conversation_title`. This provider-owned write is recorded in the
MCP operation registry and covered by the socket-level Codex rename acceptance
tests and resident-client rename/read contract tests.

The connection never sends `thread/start`, `thread/resume`, or `thread/fork`,
so the tmux-hosted Codex CLI keeps control of the conversation. Naming preserves
the AgentRun, provider session, terminal record, and tmux session identities.

Title reads and renames are cosmetic. A missing executable, unavailable or restarting
child, timeout, protocol error, malformed reply, missing name, or empty name
does not replace the title Ticketry already has or interrupt the user's work.
Rename failures return the existing structured MCP error without private launch
material. A saved manual Ticketry title takes precedence over provider names.

Codex initially names a thread from the opening message. For Ticketry launches,
that text begins with private prompt boilerplate. Rust therefore normalizes
whitespace and accepts a non-empty `thread.name` only when it is not a prefix
of the run's launch prompt. `thread.preview` is ignored. This keeps the safe
launch title until Codex supplies a real name.

For Codex Instant chats, the interactive agent names the thread from the first
actual user request using that existing rename capability. Configured operating
instructions supply context and must not become the naming source. An empty or
instruction-only launch supplies no topic. Automatic naming never saves a manual
Ticketry title; the existing title-read projection displays the provider name.

## Considered options

- Starting one app-server per read or rename was rejected because concurrent refreshes
  would multiply the measured 80 MB process cost.
- Starting, resuming, or forking threads on the resident connection was rejected
  because title operations must not take a conversation away from its interactive CLI.
