# Ideas may enter implementation without refinement

The Story workflow gains a second door into `Implement`: a human-and-agent
`Ideas → Implement` edge, opened only through the composed Run Now capability
that moves the Story and launches its implementation run in one operation. ADR
0003 said entering implementation is a human decision and made
`Tickets → Implement` human-only; that edge is unchanged. We accepted the
asymmetry — the less examined work now passes the looser gate — because the
Tickets checkpoint exists to let a person inspect an artifact, a finished spec
and the tickets generated from it, before agents act on it, and a one-line idea
has no such artifact to inspect. We rejected keeping `Ideas → Implement`
human-only, which would have denied the Ideas triage agent the one routing
decision it is best placed to make for trivial work, and we rejected opening
`Tickets → Implement` to agents for symmetry, which would have deleted the
checkpoint ADR 0003 was written to create. Two safeguards make the looser gate
survivable: Run Now always launches, so no caller can leave an idea sitting in
`Implement` with nothing running, and a new agent-allowed `Implement → Grill`
edge lets an idea that proves larger than a small direct change retreat into
refinement instead of being force-implemented.
