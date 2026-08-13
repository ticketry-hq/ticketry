"""Durable inbox for Rust-authored WorkTracker transition occurrences."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock, RLock
from weakref import WeakValueDictionary

from django.db import connection, transaction

from apps.runs.models import AutomationAttempt
from worktracker.models import Issue


logger = logging.getLogger(__name__)
DEFAULT_BATCH_SIZE = 128

_OCCURRENCE_LOCKS: WeakValueDictionary[str, RLock] = WeakValueDictionary()
_OCCURRENCE_LOCKS_GUARD = Lock()


@dataclass(frozen=True)
class TransitionOccurrence:
    id: uuid.UUID
    issue_id: uuid.UUID
    project_id: uuid.UUID
    issue_type_id: uuid.UUID
    from_state_id: uuid.UUID
    to_state_id: uuid.UUID
    workflow_revision: int


def _occurrence_lock(occurrence_id: uuid.UUID) -> RLock:
    key = occurrence_id.hex
    with _OCCURRENCE_LOCKS_GUARD:
        lock = _OCCURRENCE_LOCKS.get(key)
        if lock is None:
            lock = RLock()
            _OCCURRENCE_LOCKS[key] = lock
        return lock


def _pending_occurrences(limit: int) -> list[TransitionOccurrence]:
    tables = connection.introspection.table_names()
    if "worktracker_transitionoccurrence" not in tables:
        return []
    # Once Rust launch-policy ownership is installed, unresolved transition
    # facts are deliberately inert here. Rust resolves and submits an immutable
    # decision through launch_policy_port; Django only performs that decision.
    if "ticketry_launchpolicydecision" in tables:
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT occurrence_id, issue_id, project_id, issue_type_id,
                   from_state_id, to_state_id, workflow_revision
              FROM worktracker_transitionoccurrence occurrence
             WHERE destination_auto_start = %s
               AND NOT EXISTS (
                   SELECT 1
                     FROM automation_attempts attempt
                    WHERE attempt.transition_id = occurrence.occurrence_id
                      AND attempt.retry_of_id IS NULL
                      AND attempt.status IN (%s, %s)
               )
             ORDER BY committed_at, occurrence_id
             LIMIT %s
            """,
            [
                True,
                AutomationAttempt.Status.SUCCEEDED,
                AutomationAttempt.Status.FAILED,
                limit,
            ],
        )
        return [
            TransitionOccurrence(
                id=uuid.UUID(str(row[0])),
                issue_id=uuid.UUID(str(row[1])),
                project_id=uuid.UUID(str(row[2])),
                issue_type_id=uuid.UUID(str(row[3])),
                from_state_id=uuid.UUID(str(row[4])),
                to_state_id=uuid.UUID(str(row[5])),
                workflow_revision=int(row[6]),
            )
            for row in cursor.fetchall()
        ]


def _materialize_attempt(
    occurrence: TransitionOccurrence,
) -> AutomationAttempt | None:
    issue = (
        Issue.objects.filter(
            pk=occurrence.issue_id,
            project_id=occurrence.project_id,
            issue_type_id=occurrence.issue_type_id,
            type="task",
        )
        .select_related("project")
        .first()
    )
    if issue is None:
        logger.error(
            "transition occurrence references no eligible issue occurrence=%s issue=%s",
            occurrence.id,
            occurrence.issue_id,
        )
        return None

    with transaction.atomic():
        attempt, _created = AutomationAttempt.objects.get_or_create(
            transition_id=occurrence.id,
            retry_of__isnull=True,
            defaults={
                "issue": issue,
                "from_state_id": occurrence.from_state_id,
                "to_state_id": occurrence.to_state_id,
                "workflow_revision": occurrence.workflow_revision,
                # The occurrence identity owns the external effect before launch.
                "agent_run_id": occurrence.id.hex,
            },
        )
        if not attempt.agent_run_id:
            attempt.agent_run_id = occurrence.id.hex
            attempt.save(update_fields=["agent_run_id", "updated_at"])
        return attempt


def _consume(
    occurrence: TransitionOccurrence,
    launch_attempt: Callable[[AutomationAttempt], object],
) -> bool:
    with _occurrence_lock(occurrence.id):
        attempt = _materialize_attempt(occurrence)
        if attempt is None:
            return False
        attempt.refresh_from_db()
        if attempt.status != AutomationAttempt.Status.PENDING:
            return False
        launch_attempt(attempt)
        return True


def reconcile_pending_occurrences(
    *,
    limit: int = DEFAULT_BATCH_SIZE,
    launch_attempt: Callable[[AutomationAttempt], object] | None = None,
) -> int:
    """Drain one bounded durable batch without mutating Rust-owned facts."""

    if limit < 1:
        return 0
    if launch_attempt is None:
        from apps.execution.signals import run_automation_attempt

        def launch_attempt(attempt: AutomationAttempt) -> object:
            return run_automation_attempt(
                attempt, destination_state_id=str(attempt.to_state_id)
            )

    consumed = 0
    for occurrence in _pending_occurrences(limit):
        try:
            consumed += int(_consume(occurrence, launch_attempt))
        except Exception:
            logger.exception(
                "transition occurrence reconciliation failed occurrence=%s",
                occurrence.id,
            )
    return consumed
