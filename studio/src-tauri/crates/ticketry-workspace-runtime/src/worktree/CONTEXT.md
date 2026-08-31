# Workspace Runtime worktrees

Workspace Runtime owns the local Git checkouts used to isolate work for a Work
Item and tracks each checkout until the person removes it.

## Language

**Task worktree**:
A Git worktree owned by one top-level Work Item, with its own branch and a
recorded base captured when Ticketry creates it. Child Work Items share the
top-level Work Item's task worktree rather than owning another one.
_Avoid_: Task checkout, ticket branch, agent worktree

**Module checkout**:
The ordinary Git checkout containing a module's configured folder. Ticketry may
offer Changes, commit, and push actions for it; a non-default branch may also
open a pull request to the repository's default branch. It is not owned by a
Work Item and is never eligible for worktree cleanup.
_Avoid_: Default worktree, task worktree, cleanup candidate

**Recorded base**:
The branch and commit from which Ticketry created a task worktree. The branch is
the intended pull-request target; the commit is the fixed starting point for
the worktree's cumulative changes.
_Avoid_: Current default branch, merge base, upstream

**Worktree pull request**:
A task worktree's one recorded association to a pull request that Ticketry
created as ready for review, with the worktree branch as its head and the
recorded base branch as its base. GitHub owns the pull request and its changing
state; Ticketry owns only the association. Recording a replacement forgets the
previous association, and other repository pull requests do not belong to the
task worktree.
_Avoid_: Repository pull request, related pull request, open PR

**Pull request state**:
GitHub's current account of whether a worktree pull request is open, closed, or
merged and whether it can merge. Ticketry reads this from GitHub rather than
retaining its own copy.
_Avoid_: Worktree status, cached PR, recorded merge state

**Retargeted worktree pull request**:
A mapped pull request whose GitHub base no longer matches the worktree's
recorded base branch. Its merge does not integrate the worktree, close the Work
Item, or permit cleanup.
_Avoid_: Integrated pull request, replacement pull request

**Unavailable pull request state**:
The unknown state reported when Ticketry retains a worktree's pull-request
association but cannot read the pull request from GitHub. It is never treated
as an absent, closed, or merged pull request.
_Avoid_: No pull request, deleted pull request, closed pull request

**Ticket worktree reconciliation**:
The check made when the owning top-level Work Item is loaded. It reads the
mapped pull request from GitHub and asks the workflow to close the Work Item if
the pull request has merged into the recorded base; module-level worktree reads
never close Work Items.
_Avoid_: Background poll, startup scan, module-list transition

**Merge-preparation run**:
A user-requested agent run attached to the top-level Work Item that owns the
task worktree. It may edit, commit, and push that worktree branch to make its
pull request mergeable when conflicts or failed required checks need code
changes, but it cannot merge the pull request or remove the worktree.
_Avoid_: Automatic repair, PR agent, main-story agent

**Worktree integration**:
The event in which the worktree pull request merges into its recorded base.
It asks the normal workflow to close the top-level Work Item by moving it to
`Done`, without bypassing transition rules; closing the Work Item does not
integrate the worktree or mutate Git.
_Avoid_: Work Item completion, local landing, automatic integration

**Close a Work Item**:
Move the Work Item to its `Done` workflow state. This is distinct from closing
a pull request without merging it.
_Avoid_: Close the PR, integrate the worktree

**Cleanup candidate**:
A task worktree whose pull request has merged into the recorded base, whose
owning Work Item is in `Done`, whose checkout is clean, and whose branch has no
work after the merged pull-request head. Ticketry may offer it for confirmed
removal but does not remove it automatically.
Closing a pull request without merging never makes its worktree a cleanup
candidate.
_Avoid_: Completed worktree, closed worktree, disposable worktree

**Post-merge work**:
Uncommitted changes or branch commits that are not part of the merged worktree
pull request. They block cleanup and may be committed and sent through a
follow-up pull request, which replaces the worktree's recorded PR association.
_Avoid_: Merged work, cleanup candidate, stale branch

**Worktree cleanup**:
The user-confirmed removal of a cleanup candidate's local checkout, local task
branch, and Ticketry worktree record. It never removes the remote branch or
changes the GitHub pull request.
_Avoid_: Remote branch deletion, PR deletion, automatic cleanup
