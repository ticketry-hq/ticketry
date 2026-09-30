# Dependency-graph execution

Rust owns dependency-graph execution. A Graph Run schedules only the selected
root's direct children. The factual graph read may include deeper descendants,
but those descendants are never launch candidates for that root.

## Language

**Armed root**:
The root-keyed `GraphRun` header. It stores the execution mode and immutable
launch-policy data for children that have not started.

**Execution mode**:
The armed root's scheduling mode, `parallel` or `serial`. An omitted mode means
`parallel`. Parallel advancement claims every eligible direct child. Serial
advancement claims the first eligible child only when the serial frontier is
clear.

**Eligible child**:
An unsatisfied direct child with no launch claim whose declared blockers are
all satisfied. The root's own blockers do not gate its children.

**Live work item**:
A work item with an unfinished Agent Run or unterminated Terminal Session,
regardless of who started it.

**Startable child**:
An unsatisfied direct child with no live work and with every declared blocker
satisfied. A deliberate manual press uses startability rather than treating a
stale campaign claim as a permanent veto.

**Serial frontier**:
The claimed child a serial campaign is waiting on. The frontier clears only
when the child is satisfied and its run and terminal are inactive. An ended but
unsatisfied child stays stalled until a deliberate manual press.

**Launch claim**:
A durable `LaunchedTask` row that binds one direct child to its Graph Run,
launch generation, Agent Run, and Launch Effect. Ticketry commits the claim
before external terminal work, so replay adopts the same launch instead of
starting another agent.

**Manual press**:
A request that creates or updates the root's Graph Run and starts its currently
startable direct children. It refreshes mode and launch policy only for future
children and preserves existing launch claims.

**Satisfied issue**:
A work item that is archived, in a completed or cancelled workflow group, or
in the `Review` state.

**Subtree reset**:
A serialized deletion of one Graph Run and its launch claims. Reset does not
change Work Items, dependency edges, Agent Runs, Launch Effects, terminals, or
running processes.
