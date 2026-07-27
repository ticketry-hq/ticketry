"""#626 — the 0006 migration backfills rank in sequence_id order, then reverses.

Uses Django's MigrationExecutor against historical model states so the schema
at each step is exactly what a deployed install sees (no ``rank`` column before
0006).
"""

import uuid

import pytest
from django.db.migrations.executor import MigrationExecutor
from django.db import connection

APP = "worktracker"
BEFORE = "0005_issue_blocked_by"
AFTER = "0006_issue_rank"


@pytest.mark.django_db(transaction=True)
def test_backfill_ranks_in_sequence_order_then_reverses():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    Issue = old.get_model(APP, "Issue")

    ws = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="meml", slug="MEML"
    )
    # Create out of pk order so only sequence_id can drive the result.
    ids = {}
    for seq in [3, 1, 2]:
        issue = Issue.objects.create(
            id=uuid.uuid4(), project=project, type="task", name=f"T{seq}", sequence_id=seq
        )
        ids[seq] = issue.id

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    NewIssue = new.get_model(APP, "Issue")

    ranks = {seq: NewIssue.objects.get(pk=iid).rank for seq, iid in ids.items()}
    # Every issue gets a non-empty, unique rank.
    assert all(ranks.values())
    assert len(set(ranks.values())) == 3
    # Ranks increase in sequence_id order — today's visible order is preserved.
    assert ranks[1] < ranks[2] < ranks[3]

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    reverted = executor.loader.project_state((APP, BEFORE)).apps
    RevIssue = reverted.get_model(APP, "Issue")
    assert RevIssue.objects.filter(project_id=project.id).count() == 3

    # Restore to the leaf so later tests in the run see every table.
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
