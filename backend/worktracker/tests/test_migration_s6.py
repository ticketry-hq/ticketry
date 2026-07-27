"""S6 — the 0004 migration applies its backfill on real data and reverses.

Uses Django's MigrationExecutor against historical model states so the schema
at each step is exactly what a deployed install would see (the State table has
no ``sort_order`` at 0003, etc.).
"""

import uuid

import pytest
from django.db.migrations.executor import MigrationExecutor
from django.db import connection

APP = "worktracker"
BEFORE = "0003_issue_is_archived"
AFTER = "0004_issue_types_and_state_order"


@pytest.mark.django_db(transaction=True)
def test_backfill_maps_issues_and_orders_states_then_reverses():
    executor = MigrationExecutor(connection)

    # Rewind to the pre-S6 state.
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")
    Issue = old.get_model(APP, "Issue")

    ws = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="meml", slug="MEML"
    )
    for name, group in [
        ("Backlog", "backlog"),
        ("Todo", "unstarted"),
        ("In Progress", "started"),
        ("Done", "completed"),
        ("Cancelled", "cancelled"),
    ]:
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)
    module = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="module", name="Epic1", sequence_id=1
    )
    task = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="task", name="Task1", sequence_id=2
    )

    # Apply S6 — run the backfill RunPython on the seeded rows.
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    NewIssue = new.get_model(APP, "Issue")
    NewIssueType = new.get_model(APP, "IssueType")
    NewState = new.get_model(APP, "State")

    # 0004 retains its original two-type shape; later migrations own the
    # Story/PathFind/Implementation taxonomy and the Module rename.
    types = {t.name: t for t in NewIssueType.objects.filter(project_id=project.id)}
    assert types["Epic"].level == "module" and types["Epic"].is_default
    assert types["Task"].level == "task" and types["Task"].is_default

    assert NewIssue.objects.get(pk=module.id).issue_type_id == types["Epic"].id
    assert NewIssue.objects.get(pk=task.id).issue_type_id == types["Task"].id

    orders = sorted(
        NewState.objects.filter(project_id=project.id).values_list(
            "sort_order", flat=True
        )
    )
    assert orders == [0, 1, 2, 3, 4]

    # Reverse — the FK column drops, the issues themselves survive.
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    reverted = executor.loader.project_state((APP, BEFORE)).apps
    RevIssue = reverted.get_model(APP, "Issue")
    assert RevIssue.objects.filter(project_id=project.id).count() == 2

    # Restore the DB to the migration leaf so later tests in the run see every
    # table — including migrations from sibling tickets that land after S6.
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
