from __future__ import annotations

import uuid

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from worktracker.models import Issue, IssueType, Project

from apps.source_control.models import (
    CHECKOUT_BASE,
    CHECKOUT_WORKTREE,
    PR_MERGED,
    PR_OPEN,
    STEP_DONE,
    STEP_SKIPPED,
    ShipRecord,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID

pytestmark = pytest.mark.django_db(transaction=True)


def _outcome(status=STEP_DONE):
    return {"status": status}


def _record(**overrides) -> ShipRecord:
    values = {
        "action_id": uuid.uuid4(),
        "module_id": MODULE_ID,
        "task_id": TASK_ID,
        "checkout_kind": CHECKOUT_WORKTREE,
        "checkout_name": "Review worktree changes",
        "branch": "CODIN-1044-ship-records",
        "commit_shas": ["a" * 40],
        "commit_outcome": _outcome(),
        "push_outcome": _outcome(),
        "create_pr_outcome": _outcome(STEP_SKIPPED),
        "action_at": timezone.now(),
    }
    values.update(overrides)
    return ShipRecord.objects.create(**values)


def _other_module_and_task():
    project = Project.objects.get(pk="f1f8d941-7680-41b4-8d82-3e2f1579cd5e")
    module_type = IssueType.objects.get(project=project, level="module")
    task_type = IssueType.objects.get(project=project, level="task")
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Another module",
        sequence_id=10,
    )
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        parent=module,
        module=module,
        name="Another task",
        sequence_id=11,
    )
    return module, task


def test_schema_has_durable_identity_ordering_and_required_indexes():
    assert ShipRecord._meta.ordering == ("-action_at", "-id")
    assert ShipRecord._meta.get_field("action_id").unique is True
    assert (
        ShipRecord._meta.get_field("module").remote_field.on_delete.__name__
        == "CASCADE"
    )
    assert (
        ShipRecord._meta.get_field("task").remote_field.on_delete.__name__ == "SET_NULL"
    )
    assert {index.name for index in ShipRecord._meta.indexes} == {
        "ship_module_time_idx",
        "ship_task_time_idx",
        "ship_task_pr_time_idx",
    }
    assert ShipRecord._meta.get_field("pr_state").choices == [
        ("open", "Open"),
        ("merged", "Merged"),
        ("closed", "Closed"),
    ]


def test_creation_rejects_cross_module_and_non_anchor_task_ownership():
    _, foreign_task = _other_module_and_task()
    with pytest.raises(ValidationError, match="must belong"):
        _record(task=foreign_task, task_id=foreign_task.id)

    anchor = Issue.objects.get(pk=TASK_ID)
    subtask = Issue.objects.create(
        id=uuid.uuid4(),
        project=anchor.project,
        type="task",
        issue_type=anchor.issue_type,
        parent=anchor,
        module=anchor.module,
        name="Shared subtask",
        sequence_id=12,
    )
    with pytest.raises(ValidationError, match="top-level worktree anchor"):
        _record(task=subtask, task_id=subtask.id)


def test_base_and_worktree_creation_rules_are_enforced():
    with pytest.raises(ValidationError, match="cannot have a task owner"):
        _record(checkout_kind=CHECKOUT_BASE)
    with pytest.raises(ValidationError, match="requires an anchor task"):
        _record(task=None, task_id=None)

    base = _record(
        task=None,
        task_id=None,
        checkout_kind=CHECKOUT_BASE,
        checkout_name="Source control module",
    )
    assert base.task_id is None


def test_commit_identities_and_typed_outcomes_are_validated():
    with pytest.raises(ValidationError, match="full lowercase SHAs"):
        _record(commit_shas=["abc123"])
    with pytest.raises(ValidationError, match="done, skipped, or failed"):
        _record(push_outcome={"status": "ok"})
    with pytest.raises(ValidationError, match="optional sanitized message"):
        _record(commit_outcome={"status": STEP_DONE, "message": "x" * 513})


def test_normal_fields_are_immutable_but_pr_refresh_fields_can_change():
    record = _record(
        pr_url="https://github.com/ticketry-hq/ticketry/pull/42",
        pr_number=42,
        pr_state=PR_OPEN,
    )
    record.branch = "rewritten"
    with pytest.raises(ValidationError, match="immutable"):
        record.save()

    record.refresh_from_db()
    refreshed_at = timezone.now()
    record.pr_state = PR_MERGED
    record.pr_refreshed_at = refreshed_at
    record.save(update_fields=("pr_state", "pr_refreshed_at"))
    record.refresh_from_db()
    assert record.pr_state == PR_MERGED
    assert record.pr_refreshed_at == refreshed_at


def test_archival_and_task_deletion_retain_the_descriptive_record():
    record = _record()
    task = Issue.objects.get(pk=TASK_ID)
    task.is_archived = True
    task.save(update_fields=("is_archived",))
    record.refresh_from_db()
    assert record.task_id == task.id

    task.delete()
    record.refresh_from_db()
    assert record.task_id is None
    assert record.checkout_kind == CHECKOUT_WORKTREE
    assert record.checkout_name == "Review worktree changes"


def test_module_deletion_cascades_its_ship_records():
    module, task = _other_module_and_task()
    record = _record(module=module, module_id=module.id, task=task, task_id=task.id)
    module.delete()
    assert not ShipRecord.objects.filter(pk=record.id).exists()
