"""Commit, push, then open the pull request — as one ordered action (#984, #985).

The last and longest spelling of the write surface. It is the same stack as
:mod:`apps.source_control.stacked_action` with a third step on the end, and it
keeps that module's two shape decisions because both still hold:

*Preconditions come before the write.* Everything that could make the action
impossible is checked first — the push's (detached HEAD, no remote, no commit)
and the pull request's (the default branch, a missing or logged-out ``gh``). A
user whose ``gh`` is not logged in gets told so with their working tree
untouched, rather than after a commit and a push that now have no pull request
to justify them.

*A later failure is a step, not an error.* Once the commit lands, collapsing
the action into an error envelope would throw away the sha. So a failed push
reports as a failed step, the pull request that depended on it reports as a
skip, and the response is a 200 carrying all of it.

The pull-request-only entry point exists for the retry that follows: after
``gh auth login``, the branch is already committed and pushed, and re-running
the whole stack to reach one remaining step is a worse answer than asking for
that step. It carries one precondition the stack cannot need — the working tree
must be clean — because a pull request opened over uncommitted work would
review a branch that does not contain it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from apps.source_control import checkout_lock, pull_request, push
from apps.source_control.action_checkout import (
    module_checkout_for_action,
    task_checkout_for_action,
)
from apps.source_control.action_steps import (
    STATUS_FAILED,
    STATUS_SKIPPED,
    STEP_COMMIT,
    STEP_MESSAGE,
    STEP_PULL_REQUEST,
    STEP_STAGE,
    ActionStep,
)
from apps.source_control.checkout import Checkout, recorded_base_branch
from apps.source_control.commit import NOTHING_TO_COMMIT, CommitOutcome
from apps.source_control.stacked_action import commit_then_push


#: A pull request now exists that did not before.
OPENED = "opened"
#: The branch already had an open pull request; its URL is reported instead of
#: a second one being created.
ALREADY_OPEN = "already_open"
#: The push published nothing, so no pull request was attempted.
PUSH_FAILED = "push_failed"
#: The branch is published, but GitHub refused to open the pull request.
PULL_REQUEST_FAILED = "pull_request_failed"

STATUSES = (OPENED, ALREADY_OPEN, PUSH_FAILED, PULL_REQUEST_FAILED)


@dataclass(frozen=True)
class PullRequestActionOutcome:
    """Every step the action ran, plus the URL that is the point of running it."""

    status: str
    steps: tuple[ActionStep, ...]
    branch: str
    base_branch: str
    remote: str
    #: The pull request to open in a browser. ``None`` only when the push
    #: failed and no pull request was attempted.
    pull_request_url: Optional[str] = None
    pull_request_title: Optional[str] = None
    #: A generator name, or ``"template"``, for the pull request's text.
    pull_request_text_source: Optional[str] = None
    commit_sha: Optional[str] = None
    subject: Optional[str] = None
    message_source: Optional[str] = None
    file_count: int = 0
    insertions: int = 0
    deletions: int = 0
    pushed_sha: Optional[str] = None
    failure_code: Optional[str] = None


def commit_push_and_open_pull_request(
    checkout: Checkout,
) -> PullRequestActionOutcome:
    """Commit everything, publish the branch, and open the pull request.

    One lock for the whole sequence. All three steps have to agree on which
    commit they are talking about — the pull request describes the branch the
    push published, and it can only do that if no other writer moved HEAD in
    between.
    """

    with checkout_lock.serialized(checkout.path):
        base_branch = recorded_base_branch(checkout)
        pushable = push.preflight(checkout.path, base_branch=base_branch)
        target = pull_request.preflight(
            checkout.path,
            branch=pushable.branch,
            remote=pushable.remote,
            recorded_base=base_branch,
        )
        committed, pushed = commit_then_push(checkout, pushable)
        if pushed.step.status == STATUS_FAILED:
            return _push_failed(committed, pushed, target)
        opened = pull_request.create(checkout.path, target)

    return _combined(committed, pushed, opened)


def open_pull_request_only(checkout: Checkout) -> PullRequestActionOutcome:
    """Open the pull request for a branch that is already committed and pushed.

    Every earlier step reports as an explicit skip rather than being absent, so
    the same client renders this and the full stack from the same list.
    """

    with checkout_lock.serialized(checkout.path):
        base_branch = recorded_base_branch(checkout)
        pushable = push.preflight(checkout.path, base_branch=base_branch)
        pull_request.require_clean_tree(checkout.path)
        target = pull_request.preflight(
            checkout.path,
            branch=pushable.branch,
            remote=pushable.remote,
            recorded_base=base_branch,
        )
        pushed = push.push_branch(checkout.path, pushable)
        if pushed.step.status == STATUS_FAILED:
            return _push_failed(_nothing_committed(pushable.branch), pushed, target)
        opened = pull_request.create(checkout.path, target)

    return _combined(_nothing_committed(pushable.branch), pushed, opened)


def commit_push_and_open_pull_request_for_task(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> PullRequestActionOutcome:
    """The transport-independent entry point for the whole stack."""

    return commit_push_and_open_pull_request(
        task_checkout_for_action(task_id, parent_id, module_id)
    )


def open_pull_request_for_task(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> PullRequestActionOutcome:
    """The transport-independent entry point for the pull request on its own."""

    return open_pull_request_only(
        task_checkout_for_action(task_id, parent_id, module_id)
    )


def commit_push_and_open_pull_request_for_module(
    module_id: str,
) -> PullRequestActionOutcome:
    """The whole stack on a module base checkout, named by module.

    Offered on the module surface for the case that makes it meaningful — a
    base checkout sitting on a feature branch. On the default branch, the
    pull request's own precondition refuses the action before it writes
    anything, which is why the module footer does not make it the primary.
    """

    return commit_push_and_open_pull_request(
        module_checkout_for_action(module_id)
    )


def open_pull_request_for_module(module_id: str) -> PullRequestActionOutcome:
    """The pull request on its own for a module base checkout."""

    return open_pull_request_only(module_checkout_for_action(module_id))


def _nothing_committed(branch: str) -> CommitOutcome:
    """The commit steps a pull-request-only run reports: three explicit skips.

    Written here rather than borrowed from the commit module because these skips
    say something different from that module's: the tree is not merely clean,
    it is clean *because this action was asked not to commit*.
    """

    return CommitOutcome(
        status=NOTHING_TO_COMMIT,
        branch=branch,
        steps=(
            ActionStep(
                STEP_STAGE, STATUS_SKIPPED, "This action commits nothing."
            ),
            ActionStep(
                STEP_MESSAGE, STATUS_SKIPPED, "No commit to describe."
            ),
            ActionStep(
                STEP_COMMIT,
                STATUS_SKIPPED,
                "Asked for the pull request only.",
            ),
        ),
    )


def _push_failed(
    committed: CommitOutcome,
    pushed: push.PushOutcome,
    target: pull_request.PullRequestTarget,
) -> PullRequestActionOutcome:
    """A push that published nothing, and the pull request it made impossible.

    The skip is explicit and says *why*: a pull request opened now would
    describe a branch GitHub cannot see.
    """

    return PullRequestActionOutcome(
        status=PUSH_FAILED,
        steps=(
            *committed.steps,
            pushed.step,
            ActionStep(
                STEP_PULL_REQUEST,
                STATUS_SKIPPED,
                "Nothing was pushed, so there is no branch on GitHub to open "
                "a pull request from.",
            ),
        ),
        branch=pushed.branch,
        base_branch=target.base_branch,
        remote=pushed.remote,
        commit_sha=committed.commit_sha,
        subject=committed.subject,
        message_source=committed.message_source,
        file_count=committed.file_count,
        insertions=committed.insertions,
        deletions=committed.deletions,
        failure_code=pushed.failure_code,
    )


def _status(opened: pull_request.PullRequestOutcome) -> str:
    if opened.refused:
        return PULL_REQUEST_FAILED
    return ALREADY_OPEN if opened.existing else OPENED


def _combined(
    committed: CommitOutcome,
    pushed: push.PushOutcome,
    opened: pull_request.PullRequestOutcome,
) -> PullRequestActionOutcome:
    return PullRequestActionOutcome(
        status=_status(opened),
        # Appended, never merged: the order on the wire is the order the steps
        # ran, and a client renders it without knowing the sequence.
        steps=(*committed.steps, pushed.step, opened.step),
        branch=pushed.branch,
        base_branch=opened.base_branch,
        remote=pushed.remote,
        pull_request_url=opened.url,
        pull_request_title=opened.title,
        pull_request_text_source=opened.text_source,
        commit_sha=committed.commit_sha,
        subject=committed.subject,
        message_source=committed.message_source,
        file_count=committed.file_count,
        insertions=committed.insertions,
        deletions=committed.deletions,
        pushed_sha=pushed.pushed_sha,
        failure_code=pushed.failure_code,
    )
