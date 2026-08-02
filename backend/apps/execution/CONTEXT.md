# Subtree Execution

The execution app arms a task root and launches eligible direct children. It
does not own workflow state, dependency storage, or recursive orchestration.

## Language

**Armed root**:
The root-keyed `GraphRun` header carrying project, module, and optional agent
context. Its presence enables later state-change observations to advance that
root.

**Launch fact**:
A permanent `LaunchedTask` row recording that one direct child was successfully
spawned by a subtree run. Presence of the row prevents another launch until an
explicit subtree reset deletes it.

**Satisfied issue**:
An issue in a completed workflow group, the `Review` state, a cancelled group,
or archived. Satisfaction is the only dependency gate used by subtree
execution.

**Subtree reset**:
Deletion of one armed root's launch facts. It preserves the root header,
workflow state, and dependency edges, and starts no work by itself.
