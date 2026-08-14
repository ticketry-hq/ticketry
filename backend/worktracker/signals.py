"""Committed work-item and workflow-state change seams.

``issue_state_changed`` is the in-process event seam that the graph executor
(#700) and any future
state-driven automation hang off. Importing this module is the only wiring it
needs: the ``@receiver`` decorators connect every handler at import time, and
``WorktrackerConfig.ready()`` performs that import once at app load.

``workflow_state_changed`` carries an authoritative catalog row after any of its
projected fields change — name, group, color, sort order, or protection —
allowing project-scoped clients to repair cached copies.

The flow, for one ``Issue`` save:

1. ``_snapshot_old_state`` (``pre_save``) reads the pre-write ``state_id`` from
   the table and stashes it on the instance.
2. ``_emit_on_state_change`` (``post_save``) compares old vs. new ``state_id``;
   if they differ it resolves the from/to groups *now* (inside the txn) and
   registers a ``transaction.on_commit`` callback that sends the signal — so a
   rolled-back transition never emits.
3. The signal fans out to logging plus the ``apps.runs`` status-feed and
   ``apps.execution`` automation receivers. Grep the signal's ``dispatch_uid``
   values to enumerate the current set — the no-synchronous-state-mutation rule
   documented on ``_log_state_change`` binds all of them.

It imports only tracker models and the router-free ``state_group`` helper
(#705), so ``ready()`` can import it without dragging in the Ninja API surface.
"""

import logging
import uuid

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import Signal, receiver

from worktracker.models import Issue, IssueType, LaunchBinding, State
from worktracker.state import (
    normalize_state_id,
    state_group,
    workflow_state_projection,
)

logger = logging.getLogger(__name__)

# The seam. Sent with ``sender=Issue`` and the eight payload kwargs documented in
# ``_emit_on_state_change``. Future consumers (graph executor, #700) connect here.
issue_state_changed = Signal()
work_item_changed = Signal()
workflow_state_changed = Signal()


@receiver(pre_save, sender=State)
def _snapshot_old_workflow_state(sender, instance, **kwargs):
    """Stash the pre-write projection so ``post_save`` can diff every field.

    Snapshotting the whole projection rather than just ``group`` is what lets a
    rename, recolor, or reorder reach other clients: those edits leave the group
    untouched, so a group-only comparison discarded them and left every peer
    rendering a stale catalog row until it reconnected.
    """

    using = kwargs.get("using")
    committed = State.objects.using(using).filter(pk=instance.pk).first()
    instance._old_workflow_state = (
        workflow_state_projection(committed) if committed is not None else None
    )


@receiver(post_save, sender=State)
def _emit_on_workflow_state_change(sender, instance, created, **kwargs):
    if created:
        return
    old = getattr(instance, "_old_workflow_state", None)
    using = kwargs.get("using")
    committed = State.objects.using(using).get(pk=instance.pk)
    current = workflow_state_projection(committed)
    # Any projected field differing is a catalog edit peers must repair. A save
    # that touches only unprojected columns compares equal and stays silent.
    if old == current:
        return
    payload = {
        "project_id": str(committed.project_id),
        "state": current,
        "updated_at": committed.updated_at.isoformat(),
    }
    transaction.on_commit(
        lambda: workflow_state_changed.send_robust(sender=State, **payload),
        using=using,
    )


@receiver(pre_save, sender=Issue)
def _snapshot_old_state(sender, instance, **kwargs):
    """Stash the pre-write ``state_id`` on the instance for ``post_save``.

    Read straight from the table rather than from any in-memory FK cache, so
    the comparison can't be fooled by a stale ``issue.state``. On create the
    row does not exist yet, so the lookup returns ``None`` — which is exactly
    the desired ``from_state_id`` for a create-into-a-state event.
    """

    using = kwargs.get("using")
    instance._old_state_id = (
        Issue.objects.using(using)
        .filter(pk=instance.pk)
        .values_list("state_id", flat=True)
        .first()
    )
    instance._old_parent_id = (
        Issue.objects.using(using)
        .filter(pk=instance.pk)
        .values_list("parent_id", flat=True)
        .first()
    )


@receiver(post_save, sender=Issue)
def _emit_on_work_item_change(sender, instance, created, **kwargs):
    """Publish every committed WorkItem save on the durable project cursor."""

    if not getattr(instance, "_work_item_change_revision_advanced", False):
        return
    using = kwargs.get("using")
    old_parent_id = getattr(instance, "_old_parent_id", None)
    payload = {
        "issue_id": str(instance.pk),
        "project_id": str(instance.project_id),
        "state_id": str(instance.state_id) if instance.state_id else None,
        "revision": instance.state_revision,
        "updated_at": instance.updated_at.isoformat(),
        "membership_changed": created
        or normalize_state_id(old_parent_id)
        != normalize_state_id(instance.parent_id),
    }
    transaction.on_commit(
        lambda: work_item_changed.send_robust(sender=Issue, **payload),
        using=using,
    )


@receiver(post_save, sender=Issue)
def _emit_on_state_change(sender, instance, **kwargs):
    """Decide whether this save was a state transition; if so, defer the send.

    Change is detected on ``state_id`` *identity*, not group — a move between
    two states in the same group is still a transition. A save that leaves
    ``state_id`` untouched (name/rank/description/M2M edits, or a
    no-op re-assignment) compares equal and returns early.

    Groups are resolved here, inside the transaction, and frozen into the
    deferred closure. The actual ``send`` runs on ``transaction.on_commit`` so
    a rolled-back transition emits nothing; in autocommit it fires immediately.

    Payload (kwargs on ``issue_state_changed.send``):
        sender, transition_id, transition_snapshot, issue_id, project_id,
        from_state_id, to_state_id, from_group, to_group (groups ∈
        backlog/unstarted/started/completed/cancelled, or None).
        ``transition_id`` is minted once for correlation by idempotent post-commit
        consumers. ``transition_snapshot`` freezes from/to, the destination's
        auto-start value, and workflow revision observed by the write; none is
        live workflow state.
    """

    using = kwargs.get("using")
    old_state_id = getattr(instance, "_old_state_id", None)
    new_state_id = instance.state_id

    # Compare on the stringified id so a UUID instance and its str form (the
    # two shapes ``state_id`` can take across save paths) are treated as equal.
    if normalize_state_id(old_state_id) == normalize_state_id(new_state_id):
        return

    payload = {
        "transition_id": str(uuid.uuid4()),
        "transition_snapshot": _transition_snapshot(
            instance, old_state_id, new_state_id, using=using
        ),
        "issue_id": str(instance.pk),
        "project_id": str(instance.project_id),
        "from_state_id": str(old_state_id) if old_state_id else None,
        "to_state_id": str(new_state_id) if new_state_id else None,
        "from_group": state_group(old_state_id, using=using),
        "to_group": state_group(new_state_id, using=using),
        "revision": instance.state_revision,
        "updated_at": instance.updated_at.isoformat(),
    }

    transaction.on_commit(lambda: _emit(payload), using=using)


def _transition_snapshot(instance, from_state_id, to_state_id, *, using=None):
    """Freeze destination entry policy and revision observed by this transition."""

    if not from_state_id or not to_state_id:
        return None
    workflow_revision = (
        IssueType.objects.using(using)
        .filter(pk=instance.issue_type_id)
        .values_list("workflow_revision", flat=True)
        .first()
    )
    if workflow_revision is None:
        return None
    auto_start = LaunchBinding.objects.using(using).filter(
        issue_type_id=instance.issue_type_id,
        state_id=to_state_id,
        auto_start=True,
    ).exists()
    return {
        "from": normalize_state_id(from_state_id),
        "to": normalize_state_id(to_state_id),
        "auto_start": auto_start,
        "workflow_revision": workflow_revision,
    }


def _emit(payload):
    """Send the post-commit signal so no subscriber failure can mask the write.

    Runs strictly *after* the state write has committed, and uses ``send_robust``
    so a raising subscriber is captured and logged — never propagated back to the
    caller as a rolled-back-yet-200 (#860). The committed row is already durable
    by the time any receiver runs.
    """

    for subscriber, response in issue_state_changed.send_robust(
        sender=Issue, **payload
    ):
        if isinstance(response, Exception):
            logger.error(
                "issue_state_changed subscriber failed issue=%s receiver=%s",
                payload["issue_id"],
                getattr(subscriber, "__qualname__", subscriber),
                exc_info=response,
            )


@receiver(issue_state_changed)
def _log_state_change(sender, issue_id, from_group, to_group, **kwargs):
    """The single v1 receiver: log the transition. No mutation, by contract.

    Receivers of ``issue_state_changed`` MUST NOT synchronously mutate
    ``Issue.state`` (or call ``Issue.save`` with a state change): the signal is
    emitted from a ``post_save`` chain and doing so would re-enter the emit
    path. Schedule any state-changing follow-up out of band instead.
    """

    logger.info(
        "issue_state_changed issue_id=%s %s -> %s",
        issue_id,
        from_group,
        to_group,
    )
