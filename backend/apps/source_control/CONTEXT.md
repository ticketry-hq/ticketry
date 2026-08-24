# Source Control

Source Control owns review and shipping actions for linked module checkouts and
task worktrees. It remembers completed shipping attempts after live checkout
state disappears.

## Language

**Ship action**:
One ordered attempt to commit, push, and optionally open a pull request from a
single checkout.
_Avoid_: Release, deployment, publish job

**Ship record**:
The immutable receipt for one ship action whose commit step started. Later
push or pull request failures remain part of the same receipt.
_Avoid_: Commit record, PR record, activity log

**Base checkout**:
The linked repository checkout owned by a module. Its ship records have no task
owner.
_Avoid_: Main worktree, root task

**Task worktree**:
A checkout shared by an anchor task and its subtasks.
_Avoid_: Subtask worktree, child checkout

**Anchor task**:
The top-level task that owns a task worktree and its ship records. A subtask
using that worktree is never another owner.
_Avoid_: Source task, shared owner

**PR state refresh**:
One person-triggered GitHub lookup that replaces only a ship record's stored
pull request state and successful-refresh time.
_Avoid_: Poll, sync job, status feed
