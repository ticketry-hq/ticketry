"""Commit then push, as one ordered action (#983, #985).

The write surface is a *stack*, not a set of independent buttons: the steps
run in one fixed order under one lock, and the result is the ordered list of
what each step did. That shape is the point — a caller renders progress and an
outcome from the same list, and a step that did not run says so as a skip
rather than by being absent.

Two properties are worth naming, because both are choices:

*Preconditions come before the write.* A checkout that could never publish —
detached HEAD, no remote, no commit — is refused before the commit runs, so
the action never leaves a commit behind for a push it always knew was
impossible.

*Divergence does not.* It is a fact about the remote, discovered after the
commit is already worth keeping. The push step fails, the commit stands, and
the outcome carries both — which is why a failed push is a 200 with a typed
step and not an error envelope: an error would throw away the sha the caller
has to show.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from apps.source_control import checkout_lock, push
from apps.source_control.action_checkout import (
    module_checkout_for_action,
    task_checkout_for_action,
)
from apps.source_control.action_steps import (
    STATUS_FAILED,
    STEP_COMMIT,
    STEP_PUSH,
    ActionStep,
)
from apps.source_control.checkout import Checkout, recorded_base_branch
from apps.source_control.commit import (
    COMMITTED,
    CommitOutcome,
    commit_locked_checkout,
)
from apps.source_control.ship_records import (
    failed_action,
    new_action_id,
    persist_ship_record_or_fail,
)

if TYPE_CHECKING:
    from apps.source_control.models import ShipRecord


#: The action's summary verdict, discriminated on by a client that wants one
#: sentence rather than the step list.
COMMITTED_AND_PUSHED = "committed_and_pushed"
#: Nothing to commit, but the branch had unpushed commits and now does not.
PUSHED = "pushed"
#: Nothing to commit and the remote already had everything.
UP_TO_DATE = "up_to_date"
#: The push did not publish. ``commit_sha`` says whether a commit still landed.
PUSH_FAILED = "push_failed"

STATUSES = (COMMITTED_AND_PUSHED, PUSHED, UP_TO_DATE, PUSH_FAILED)


@dataclass(frozen=True)
class StackedOutcome:
    """Every step the action ran, plus what it added up to."""

    status: str
    steps: tuple[ActionStep, ...]
    branch: str
    remote: str
    commit_sha: str | None = None
    subject: str | None = None
    message_source: str | None = None
    file_count: int = 0
    insertions: int = 0
    deletions: int = 0
    #: What the remote branch points at now, when this action moved it.
    pushed_sha: str | None = None
    #: Why the push published nothing, from :mod:`apps.source_control.push`.
    failure_code: str | None = None
    commit_shas: tuple[str, ...] = ()
    action_id: uuid.UUID | None = None
    ship_record: ShipRecord | None = None


def commit_and_push(
    checkout: Checkout,
    *,
    action_id: uuid.UUID | str | None = None,
) -> StackedOutcome:
    """Commit everything in ``checkout``, then publish its branch.

    One lock for the whole sequence. The commit and the push have to agree on
    which commit they are talking about, and they only do if no other writer
    can move HEAD between them.
    """

    resolved_action_id = new_action_id(action_id)
    with checkout_lock.serialized(checkout.path):
        # Before anything is written: a checkout that cannot publish is
        # refused here, not after it has a commit it cannot ship.
        pushable = push.preflight(
            checkout.path, base_branch=recorded_base_branch(checkout)
        )
        try:
            committed = commit_locked_checkout(checkout)
        except Exception:
            terminal = failed_action(checkout, phase=STEP_COMMIT)
            persist_ship_record_or_fail(
                checkout,
                terminal,
                action_id=resolved_action_id,
            )
            raise
        try:
            pushed = push.push_branch(checkout.path, pushable)
        except Exception:
            terminal = failed_action(
                checkout,
                phase=STEP_PUSH,
                completed_steps=committed.steps,
                commit_shas=committed.commit_shas,
                remote=pushable.remote,
                commit_sha=committed.commit_sha,
            )
            persist_ship_record_or_fail(
                checkout,
                terminal,
                action_id=resolved_action_id,
            )
            raise

    outcome = _combined(committed, pushed)
    record = persist_ship_record_or_fail(
        checkout,
        outcome,
        action_id=resolved_action_id,
    )
    return replace(
        outcome,
        action_id=resolved_action_id,
        ship_record=record,
    )


def commit_then_push(
    checkout: Checkout, pushable: push.Pushable
) -> tuple[CommitOutcome, push.PushOutcome]:
    """The commit and the push, for a caller that already holds the lock.

    Separate from :func:`commit_and_push` because a *longer* stack exists: the
    pull-request action runs these two steps and then a third, and all three
    have to happen under one lock. Splitting the lock out of the sequence is
    what lets the outermost action own it, which is the only place it can be
    owned correctly.
    """

    committed = commit_locked_checkout(checkout)
    return committed, push.push_branch(checkout.path, pushable)


def commit_and_push_worktree(
    task_id: str,
    parent_id: str | None = None,
    module_id: str | None = None,
    action_id: uuid.UUID | str | None = None,
) -> StackedOutcome:
    """The transport-independent entry point, named by task rather than path."""

    return commit_and_push(
        task_checkout_for_action(task_id, parent_id, module_id),
        action_id=action_id,
    )


def commit_and_push_module(
    module_id: str, action_id: uuid.UUID | str | None = None
) -> StackedOutcome:
    """The same action on a module base checkout, named by module.

    This is the module checkout's *terminal* action (ADR 0013): a base checkout
    normally sits on the default branch, where a pull request is refused, so
    committing and publishing is the whole flow rather than a shorter stop on
    the way to one.
    """

    return commit_and_push(
        module_checkout_for_action(module_id),
        action_id=action_id,
    )


def _combined(committed: CommitOutcome, pushed: push.PushOutcome) -> StackedOutcome:
    return StackedOutcome(
        status=_status(committed, pushed),
        # The push step is appended, never merged in: the order on the wire is
        # the order the steps ran, and a client renders it without knowing it.
        steps=(*committed.steps, pushed.step),
        # git's branch, not the worktrees index's — the push preflight read the
        # checkout's present state, and that is what was published.
        branch=pushed.branch,
        remote=pushed.remote,
        commit_sha=committed.commit_sha,
        subject=committed.subject,
        message_source=committed.message_source,
        file_count=committed.file_count,
        insertions=committed.insertions,
        deletions=committed.deletions,
        pushed_sha=pushed.pushed_sha,
        failure_code=pushed.failure_code,
        commit_shas=pushed.commit_shas,
    )


def _status(committed: CommitOutcome, pushed: push.PushOutcome) -> str:
    if pushed.step.status == STATUS_FAILED:
        return PUSH_FAILED
    if pushed.published:
        return COMMITTED_AND_PUSHED if committed.status == COMMITTED else PUSHED
    # A skipped push means the remote already held HEAD exactly, which a commit
    # made a moment ago cannot be. So this is the clean-tree, nothing-to-do case.
    return UP_TO_DATE
