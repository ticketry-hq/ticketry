# Execution Engine

The vocabulary of dependency-graph campaign execution: how a root work item's
descendant tree is launched, how per-node progress is durably recorded, and how
a poisoned run is recovered. Not the tracker's storage model (that is
worktracker) and not the launch-prompt substrate (that is the agent SDLC
workflow context).

## Language

**Graph run**:
The root-keyed durable header recording that a dependency graph was executed
for a root work item, carrying its project/module context and optional
graph-wide provider override. It stores no edges and no per-node status.
_Avoid_: campaign record, attempt id, graph snapshot

**Durable node fact**:
The per-task engine-run row (implement phase) recording a graph node's
last-known execution status, agent run id, and error. An absent row *is* the
idle status — nodes are re-seeded idle when no fact exists, and `done`/
`running` are re-derived from the tracker and live agent runs on every rebuild.
_Avoid_: node table, attempt history, in-memory status

**Ready set**:
The idle nodes whose in-graph blockers are all done — the only nodes a graph
execution launches. Re-executing a graph is an idempotent re-evaluation of the
ready set, never a retry of recorded failures.
_Avoid_: frontier flag (tracker-side), retry batch

**Dependency halt**:
The transitive marking of a failed node's idle descendants as `halted`, ending
the campaign for that branch while independent branches continue. Halted nodes
were never launched and hold no agent run.
_Avoid_: cancellation, blocked state (tracker-side)

**Graph reset**:
The supported recovery operation for a poisoned graph run: it deletes the
durable node facts in `failed` or `halted` status beneath a root so those
nodes rebuild as idle, evicts the process cache, and launches nothing. Retry
is reset followed by a normal execute. It never touches done or running facts,
the graph-run header, workflow states, or dependency edges.
_Avoid_: registry wipe, attempt retry, planning-run release
