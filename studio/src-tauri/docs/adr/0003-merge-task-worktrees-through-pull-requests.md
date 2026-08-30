# Merge task worktrees through pull requests

Ticketry previously treated a Work Item's move into a completed workflow group
as an instruction to merge its task branch into the local base, then remove the
checkout and branch. We decided that completing a Work Item must not mutate
Git. Ticketry instead tracks the pull request from that task worktree to its
recorded base and treats a merge into that base as integration. Integration
moves the top-level Work Item to `Done` and may make the worktree eligible for
separately confirmed removal; moving the Work Item to `Done` never causes the
reverse Git operation. This keeps code review and remote merge state
authoritative and prevents a workflow transition from deleting local code. The
first version tracks only pull requests created through Ticketry. Discovering
and adopting a matching pull request created elsewhere is deferred. A pull
request closed without merging leaves the worktree active and may be followed
by a replacement pull request. The worktree row holds one pull-request
association, so recording the replacement overwrites the closed pull request
rather than building a local PR history. Only a merge can make the worktree
eligible for cleanup.

The first version does not reconcile an interrupted pull-request creation. If
GitHub creates the pull request but Ticketry loses the response before saving
the mapping, a later retry may create another pull request or receive GitHub's
duplicate error. Ticketry does not search for or adopt the first pull request;
stale remote pull requests remain a separate cleanup concern.

The worktree row stores only the mapping to its pull request. GitHub remains
authoritative for the pull request's content, open or closed state, merged
state, checks, and mergeability; Ticketry reads those facts from GitHub instead
of persisting a second copy. A failed GitHub read leaves the mapping intact and
reports an unavailable state. It cannot authorize a replacement pull request or
worktree cleanup.

The mapped pull request must still target the worktree's recorded base. If
someone retargets it on GitHub, even a merge does not integrate the worktree,
close the Work Item, or permit cleanup.

The automatic move to `Done` uses the Work Item's normal workflow transition.
If the workflow rejects that move, Ticketry reports the merged pull request and
the failed close separately. It never bypasses workflow rules, and the
worktree cannot become a cleanup candidate until the Work Item reaches `Done`.
Ticketry re-evaluates eligibility, so a Work Item that reaches `Done` later can
still make its merged, unchanged worktree eligible.

Ticketry reconciles a merged pull request into the Work Item workflow only when
the owning ticket loads. The module worktree list may read and display live
GitHub state, but it never changes a Work Item. Ticketry does not poll in the
background or scan every mapped pull request at startup.

Ticketry may offer agent help when the pull request needs work, but only after
the user explicitly requests it. The resulting run belongs to the top-level
Work Item and operates in that Work Item's task worktree. That request
authorizes the agent to edit, commit, and push only the worktree branch; it does
not authorize merging the pull request or removing the worktree. Ticketry offers
this help for merge conflicts and failed required checks, not for pending checks
or missing human approval.

Confirmed cleanup removes the local checkout, local task branch, and worktree
row. It leaves the remote branch and GitHub pull request untouched.

Uncommitted changes do not block pushing existing commits or creating a pull
request from them. Ticketry identifies those changes as excluded and never
commits them implicitly.

Work added after the mapped pull request merges blocks cleanup. Ticketry offers
a follow-up pull request for that work, and recording it overwrites the merged
pull-request mapping.

Ticketry creates ordinary ready-for-review pull requests. Draft creation and
promotion are outside the first version.

The mapped-PR, Work Item closing, and cleanup lifecycle applies only to task
worktrees that Ticketry created. A module's ordinary checkout receives Changes,
commit, and push actions but never becomes a cleanup candidate. It offers pull
request creation only from a non-default branch to the repository's default
branch.
