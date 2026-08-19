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
and then opaque task id. A manual press may replace the stored mode just as it
refreshes the launch context.

**Eligible child**:
A direct child whose own work is unsatisfied, which this root recorded no launch
fact for, and whose every declared blocker is satisfied. Both execution modes
share this one predicate; they differ only in how many eligible children one
advancement launches.

**Live work item**:
A work item with an agent run that has not ended or a terminal session that has
not terminated recorded against it — whichever started it, campaign or hand.
`work_item_liveness` is the single expression of this rule; a caller may discount
one agent run (its own) so a run asking about its own work item does not see
itself. Both surfaces that ask read it: *startable child* over a set of
children, *run now* over one target. Deliberately not a fact about a campaign's
launch ledger.

**Startable child**:
A direct child a manual subtree-run press may start: its own work is
unsatisfied, every blocker it declares is satisfied, and no agent run or
terminal session is live *on that child*. Liveness is a fact about the work
item, so an agent the user started by hand counts and a stale launch fact on a
sibling does not. Serial and parallel presses share this one predicate and
differ only in how many startable children they take — serial takes the lowest
by ascending stored sequence number then opaque task id, parallel takes all of
them. Distinct from *Eligible child*, which governs automatic advancement and
reads the launch ledger instead.

**Working campaign**:
A serial root with at least one direct child that is live and still unsatisfied.
A serial press starts nothing there: serial order comes from the stored sequence
number rather than from `blocked_by` edges, so the siblings of a running child
declare no blocker and would otherwise read as startable — an extra press would
put a second agent inside a one-at-a-time campaign. The hold is derived from the
work (per-work-item liveness plus satisfaction), never from the launch ledger,
so a satisfied child whose run record was never closed holds nothing and the
press still gets a stuck campaign moving. Parallel presses have no such hold.

**Serial frontier**:
The recorded launch a serial campaign is waiting on, governing *automatic*
advancement only. It holds the frontier while its agent run or terminal is live,
and keeps holding it once that run has ended without its child becoming
satisfied — a *stalled frontier*, which waits for a manual press rather than
skipping ahead. A manual press never consults it, because campaign-wide liveness
is exactly what deadlocked the press. Advancement is serialized
per root so concurrent manual and lifecycle triggers cannot both pass the
frontier check; the `launched_tasks` primary key is the final duplicate guard,
because automatic advancement inserts its launch fact or fails.

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
spawned by a subtree run. It is a record of what was started, and it gates
*automatic* advancement only — a manual press reads the work instead, so a
launch fact is no longer the manual relaunch gate. A manual press retrying a
child updates that child's existing row in place, but only when the row belongs
to the same campaign; automatic advancement always inserts, so the one row per
work item stays the final duplicate guard and a child recorded by another root
raises rather than being reassigned. Subtree reset is the way to discard the
ledger.

**Manual press**:
An execute request for a work item, armed or not. An unarmed root is armed
exactly as before. An armed root keeps its header and its whole launch ledger:
the request refreshes project, module, provider override, and execution mode,
then launches its *startable children*. It never conflicts on the campaign's own
liveness. Completed, cancelled, archived, and Review children remain satisfied
and are not relaunched; a press that can start nothing launches nothing and says
so with an empty launched list.

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

**Run now**:
The composed capability that sends one idea straight into implementation: it
moves a Story from `Ideas` to `Implement` through the ordinary transition gate,
stamping its caller's real origin, and then launches a task-scoped run for the
committed destination. It is deliberately *not* subtree execution — it arms no
root, writes no launch fact, and observes no frontier. It refuses outright when
the target is a *live work item* by the shared rule, discounting the calling
agent run so a run may send its own idea onward, and resolves module
ancestry, profile, launch binding, and required skills before moving, so a
knowable prerequisite failure leaves the Story in `Ideas`. Its move and its
launch are one capability precisely so no caller can leave an idea in
`Implement` with nothing running.
_Avoid_: Instant change, quick run, direct launch

**Subtree reset**:
Deletion of one armed root's launch facts. It preserves the root header,
workflow state, and dependency edges, and starts no work by itself. Reset takes
the same per-root serialization execution and advancement take, so it can never
land between an in-flight launch and the launch fact that records it.
