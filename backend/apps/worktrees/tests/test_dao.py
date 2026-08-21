"""Unit tests for the worktrees sync ORM layer (#585)."""

from __future__ import annotations

import pytest

from apps.worktrees import dao
from apps.worktrees.models import Worktree


pytestmark = [pytest.mark.django_db(transaction=True)]


def _mk(task_id="t1", **over):
    fields = dict(
        task_id=task_id,
        repo_root="/repo",
        path=f"/wt/{task_id}",
        branch=f"wt/CODIN-{task_id}",
        base_branch="main",
        base_commit="deadbeef",
    )
    fields.update(over)
    return dao.create(**fields)


def test_create_and_get_round_trip():
    created = _mk(project_id="p1", module_id="m1", ticket_seq=5)
    fetched = dao.get_by_task("t1")
    assert fetched.id == created.id
    assert fetched.status == "active"
    assert fetched.ephemeral is False
    assert fetched.created_at == fetched.updated_at  # stamped together on insert
    assert not hasattr(fetched, "workspace_slug")


def test_task_id_unique():
    _mk("t1")
    with pytest.raises(Exception):
        _mk("t1")


def test_set_status_bumps_updated_at():
    created = _mk("t1")
    assert dao.set_status("t1", "conflict") is True
    row = dao.get_by_task("t1")
    assert row.status == "conflict"
    assert row.updated_at >= created.updated_at


def test_delete():
    _mk("t1")
    dao.delete("t1")
    assert dao.get_by_task("t1") is None


def test_list_by_scope():
    _mk("t1", project_id="p1", module_id="m1")
    _mk("t2", project_id="p1", module_id="m2")
    _mk("t3", project_id="p2", module_id="m9")

    assert {w.task_id for w in dao.list_by_scope(project_id="p1")} == {"t1", "t2"}
    assert {w.task_id for w in dao.list_by_scope(module_id="m2")} == {"t2"}
    assert len(dao.list_by_scope()) == 3


def test_get_missing_returns_none():
    assert dao.get_by_task("nope") is None


def test_get_by_task_does_not_close_connection_mid_transaction():
    """``get_by_task`` runs inside the ``integrate_on_complete`` post_save while
    the transition's transaction is open; it must leave the connection usable so
    a later write in the same atomic (e.g. the forced-move audit row) succeeds.
    """
    from django.db import transaction

    _mk("t1")
    with transaction.atomic():
        dao.get_by_task("t1")
        # Before the fix this raised "Cannot operate on a closed database".
        Worktree.objects.create(
            task_id="t2",
            repo_root="/repo",
            path="/wt/t2",
            branch="wt/CODIN-t2",
            base_branch="main",
            base_commit="deadbeef",
        )
    assert dao.get_by_task("t2") is not None
