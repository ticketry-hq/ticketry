# One live agent per work item, decided by the transition edge

A work item has at most one live task agent. The transition edge's existing
handoff mark is the only thing that decides what happens to that agent on an
agent move or Run Now: a handoff edge continues the agent in its own session,
a replacing edge ends it with the terminal cleanup kill before the destination
starts fresh. If the kill fails, the state still commits, nothing starts, and
the launch-failure indicator offers retry. Manual moves in Studio never end or
start an agent while one is live.

Handoff notes — the document an ending agent leaves for its replacement, named
`<source-state>-handoff.md` in the task's design directory — are the agent's
job under the state's launch prompt. Ticketry does not type a request for
them, wait for them, or block a move on them. It only names the note in the
replacement's launch prompt when the file exists.

## Considered options

- Letting agents stack on one work item was rejected: no current use needs two
  agents on one story, and stacking is what made replacing moves ambiguous.
- A second per-edge flag separating "keep agent" from "deliver prompt" was
  rejected: keep-without-prompt has no use, and one mark is easier to read.
- System-orchestrated notes (Ticketry types `/handoff`, waits up to a timeout,
  rejects the move or holds it pending until the file lands) were designed and
  then rejected: they add a pending-transition state, a timeout, path watching,
  a per-provider skill dependency, and a deadlock when the moving agent is
  inside the tool call. A prompt instruction achieves the same with no
  machinery.
- Run Now previously refused while another run was live on the work item; it
  now replaces that run, because a person pressing Run Now has already decided
  which agent should be working.
