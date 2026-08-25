"""What the confirmation step shows before anything leaves the machine (#983, #985).

The one thing standing between a local commit and a remote is a confirmation,
and a confirmation is only worth having if the numbers on it are true. So this
is a real read, not a guess assembled on the client: it resolves the branch,
resolves the remote, probes that remote once, and counts the commits the push
would actually publish — including the one the action is about to create from
the working tree, because that commit is part of what the user is agreeing to
send.

What it deliberately does *not* carry is any generated commit text. The
generator runs inside the action, after the confirmation, so there is nothing
here that could show a user a message and then commit a different one. That is
a structural guarantee rather than a rule someone has to remember.

A blocked checkout answers with a state and a sentence rather than an error:
the confirmation's job is to explain why the action cannot run, and it can
only do that if being unable to run is data it can render.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from apps.source_control.actions import push
from apps.source_control.actions.action_checkout import (
    module_checkout_for_action,
    task_checkout_for_action,
)
from apps.source_control.changes.change_status import collect_changes
from apps.source_control.checkouts.checkout import Checkout, recorded_base_branch
from apps.source_control.checkouts.remote_branch import read_position

#: The action can run, and the confirmation shows what it would send.
READY = "ready"
#: Nothing to commit and the remote already holds this branch's HEAD.
UP_TO_DATE = "up_to_date"
#: The remote holds commits this branch does not; only a terminal fixes that.
DIVERGED = "diverged"
#: HEAD is not on a branch, so there is no refspec to push.
DETACHED = "detached_head"
#: The branch has no commit yet.
UNBORN = "unborn_branch"
#: There is no remote to push to.
NO_REMOTE = "no_remote"

STATES = (READY, UP_TO_DATE, DIVERGED, DETACHED, UNBORN, NO_REMOTE)

#: The sentence each blocked state shows in place of a commit count.
_BLOCKED_DETAIL = {
    DETACHED: (
        "This checkout is on a detached HEAD, so there is no branch to push. "
        "Check out a branch in a terminal first."
    ),
    UNBORN: "This branch has no commits yet, so there is nothing to push.",
    NO_REMOTE: (
        "This branch has no remote to push to. Add one in a terminal first."
    ),
}


@dataclass(frozen=True)
class PushPreview:
    """Everything the confirmation step needs, and nothing it must not show."""

    state: str
    branch: str
    remote: Optional[str]
    #: How many commits this push would publish, counting the one the action
    #: is about to create when the working tree is dirty. Meaningful only in
    #: the ``ready`` state; a blocked preview shows its ``detail`` instead.
    commit_count: int
    #: Whether the action would commit before pushing.
    dirty: bool
    detail: str = ""


def preview_worktree_push(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> PushPreview:
    """The confirmation for the task worktree's commit-and-push action."""

    return preview(task_checkout_for_action(task_id, parent_id, module_id))


def preview_module_push(module_id: str) -> PushPreview:
    """The confirmation for the module base checkout's commit-and-push action.

    The same read, resolved from a module instead of a task. A base checkout
    has no recorded base branch, which changes nothing here: the count is of
    commits this branch has that its own remote branch does not.
    """

    return preview(module_checkout_for_action(module_id))


def preview(checkout: Checkout) -> PushPreview:
    base_branch = recorded_base_branch(checkout)
    inspected = push.inspect(checkout.path, base_branch=base_branch)
    if isinstance(inspected, push.NotPushable):
        return _blocked(inspected)

    dirty = collect_changes(checkout.path).dirty
    standing = read_position(
        checkout.path,
        branch=inspected.branch,
        remote=inspected.remote,
        head=inspected.head_sha,
        base_branch=base_branch,
    )
    if not standing.fast_forward:
        return PushPreview(
            state=DIVERGED,
            branch=inspected.branch,
            remote=inspected.remote,
            commit_count=0,
            dirty=dirty,
            detail=(
                f"{inspected.remote}/{inspected.branch} has commits this "
                "branch does not. Ticketry never merges or rebases for you — "
                "resolve it in a terminal, then push again."
            ),
        )
    if standing.up_to_date and not dirty:
        return PushPreview(
            state=UP_TO_DATE,
            branch=inspected.branch,
            remote=inspected.remote,
            commit_count=0,
            dirty=False,
            detail=(
                f"{inspected.remote}/{inspected.branch} already has this "
                "commit, and there is nothing to commit."
            ),
        )
    return PushPreview(
        state=READY,
        branch=inspected.branch,
        remote=inspected.remote,
        # The pending commit counts: the user is agreeing to send it too.
        commit_count=standing.commit_count + (1 if dirty else 0),
        dirty=dirty,
    )


_BLOCKED_STATES = {
    push.BLOCKED_DETACHED_HEAD: DETACHED,
    push.BLOCKED_UNBORN_BRANCH: UNBORN,
    push.BLOCKED_NO_REMOTE: NO_REMOTE,
}


def _blocked(inspected: "push.NotPushable") -> PushPreview:
    state = _BLOCKED_STATES[inspected.code]
    return PushPreview(
        state=state,
        branch=inspected.branch,
        remote=None,
        commit_count=0,
        dirty=False,
        detail=_BLOCKED_DETAIL[state],
    )
