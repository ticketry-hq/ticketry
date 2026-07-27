"""#629 — the 0008 migration adds Blocked + stamps protected flags on real data.

Uses Django's MigrationExecutor against historical model states so the schema
at each step is exactly what a deployed install would see (the State table has
no ``is_protected`` until 0008).
"""

import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0007_sprint_lifecycle"
AFTER = "0008_state_is_protected_and_blocked"

FIVE_STATES = [
    ("Backlog", "backlog"),
    ("Todo", "unstarted"),
    ("In Progress", "started"),
    ("Done", "completed"),
    ("Cancelled", "cancelled"),
]


def _rewind_to_before():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, BEFORE)).apps


def _apply_after():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, AFTER)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_backfill_adds_blocked_orders_and_stamps_then_idempotent():
    old = _rewind_to_before()
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")

    ws = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="meml", slug="MEML"
    )
    for name, group in FIVE_STATES:
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)

    new = _apply_after()
    NewState = new.get_model(APP, "State")

    rows = list(NewState.objects.filter(project_id=project.id))
    # 0008 still creates the Blocked row and stamps six distinct sort_orders.
    # Canonical *ordering* and *protection* are finalized later by 0010
    # (CODIN-859), so at this boundary only the row set and distinct orders are
    # asserted — Blocked is no longer a protected key.
    names = {s.name for s in rows}
    assert names == {
        "Backlog",
        "Todo",
        "Blocked",
        "In Progress",
        "Done",
        "Cancelled",
    }
    assert sorted(s.sort_order for s in rows) == [0, 1, 2, 3, 4, 5]
    protected = {s.name for s in rows if s.is_protected}
    assert protected == {"Blocked", "In Progress", "Done"}

    # Re-running the backfill is a no-op: no duplicate Blocked, same 6 rows.
    migration = importlib.import_module(
        "worktracker.migrations.0008_state_is_protected_and_blocked"
    )
    migration.backfill(new, None)
    after = NewState.objects.filter(project_id=project.id)
    assert after.count() == 6
    assert after.filter(name="Blocked").count() == 1

    _restore_leaf()


@pytest.mark.django_db(transaction=True)
def test_backfill_with_manual_blocked_stamps_not_duplicates():
    old = _rewind_to_before()
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")

    ws = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="meml", slug="MEML"
    )
    for name, group in FIVE_STATES:
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)
    # A hand-made Blocked already exists in the unstarted group.
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Blocked", group="unstarted"
    )

    new = _apply_after()
    NewState = new.get_model(APP, "State")

    # A hand-made Blocked is not duplicated and receives the historical lock.
    blocked = NewState.objects.filter(project_id=project.id, name="Blocked")
    assert blocked.count() == 1
    assert blocked.first().is_protected is True

    _restore_leaf()
