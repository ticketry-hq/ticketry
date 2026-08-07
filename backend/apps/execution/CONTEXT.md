# Subtree Execution

The execution app arms a task root and launches eligible direct children. It
does not own workflow state, dependency storage, or recursive orchestration.

## Language

**Armed root**:
The root-keyed `GraphRun` header carrying project, module, and optional agent
context. Its presence enables later state-change observations to advance that
root.

**Launch fact**:
A durable `LaunchedTask` row recording that one direct child was successfully
spawned by a subtree run. Presence of an active associated run or terminal
prevents another launch. A user repeating the execute request after every prior
launch has ended clears inactive facts and revives unfinished children.

**Subtree revival**:
A repeat execute request for an armed root. It returns the existing conflict
while any recorded run or terminal remains active. With no active launch, it
refreshes the header, clears stale launch facts, and advances the current graph.
Completed, cancelled, archived, and Review children remain satisfied and are
not relaunched.

**Satisfied issue**:
An issue in a completed workflow group, the `Review` state, a cancelled group,
or archived. Satisfaction is the only dependency gate used by subtree
execution.

**Subtree reset**:
Deletion of one armed root's launch facts. It preserves the root header,
workflow state, and dependency edges, and starts no work by itself.
