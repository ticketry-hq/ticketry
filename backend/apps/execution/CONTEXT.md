# Subtree Execution

The execution app arms a task root and launches eligible direct children. It
does not own workflow state, dependency storage, or recursive orchestration.

## Language

**Armed root**:
The root-keyed `GraphRun` header carrying project, module, execution mode, and
optional agent context. Its presence enables later state-change observations to
advance that root.

**Execution mode**:
The armed root's durable scheduling mode, `parallel` or `serial`. A create
request that omits it means `parallel`, which is the historical fan-out over
every eligible direct child. A `serial` root instead launches exactly one
eligible child per advancement, ordered by ascending WorkTracker sequence number
and then opaque task id. Subtree revival may replace the stored mode just as it
refreshes the launch context.

**Eligible child**:
A direct child whose own work is unsatisfied, which this root recorded no launch
fact for, and whose every declared blocker is satisfied. Both execution modes
share this one predicate; they differ only in how many eligible children one
advancement launches.

**Serial frontier**:
The recorded launch a serial campaign is waiting on. It holds the frontier while
its agent run or terminal is live, and keeps holding it once that run has ended
without its child becoming satisfied — a *stalled frontier*, which waits for
explicit subtree revival rather than skipping ahead. Advancement is serialized
per root so concurrent manual and lifecycle triggers cannot both pass the
frontier check; the `launched_tasks` primary key is the final duplicate guard.

**Liveness refresh**:
The request this app makes when a serial frontier is pending *purely* on
liveness: every launched child is satisfied and only a live agent run or
terminal holds the frontier. An agent that exits by itself writes no termination
fact, so the driver asks terminals to reconcile now instead of waiting for the
next sweep. The request is best-effort and does not advance anything by itself —
reconciliation publishes the durable termination, which re-enters the completion
observation through the ordinary path. A stalled frontier makes no such request,
because it waits for the user either way.

**Launch fact**:
A durable `LaunchedTask` row recording that one direct child was successfully
spawned by a subtree run. Presence of an active associated run or terminal
prevents another launch. A user repeating the execute request after every prior
launch has ended clears inactive facts and revives unfinished children.

**Subtree revival**:
A repeat execute request for an armed root. It returns the existing conflict
while any recorded run or terminal remains active. With no active launch, it
refreshes the header (including its execution mode), clears stale launch facts,
and advances the current graph.
Completed, cancelled, archived, and Review children remain satisfied and are
not relaunched.

**Completion observation**:
A committed high-level fact this app re-evaluates armed roots from. There are
two, and they are read symmetrically so progress does not depend on their order:
a work-item state change, and the run completion seam a durable agent-run or
terminal termination publishes. Whichever arrives first only re-checks the
frontier; whichever arrives second advances it. Termination observations
re-evaluate serial roots only, because parallel fan-out has never depended on
agent liveness. Lifecycle-triggered advancement takes the same per-root
serialization a manual request takes, so a lifecycle observation racing a manual
request still yields one launch.

**Satisfied issue**:
An issue in a completed workflow group, the `Review` state, a cancelled group,
or archived. Satisfaction is the only dependency gate used by subtree
execution.

**Subtree reset**:
Deletion of one armed root's launch facts. It preserves the root header,
workflow state, and dependency edges, and starts no work by itself. Reset takes
the same per-root serialization execution and advancement take, so it can never
land between an in-flight launch and the launch fact that records it.
