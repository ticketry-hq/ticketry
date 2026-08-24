import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.source_control.tests.conftest import MODULE_ID, TASK_ID


@pytest.mark.django_db(transaction=True)
def test_initial_migration_preserves_existing_work_items_and_adds_ship_records():
    executor = MigrationExecutor(connection)
    executor.migrate([("source_control", None)])

    old_apps = executor.loader.project_state(
        ("worktracker", "0051_codex_5_3_model_catalog")
    ).apps
    OldIssue = old_apps.get_model("worktracker", "Issue")
    assert OldIssue.objects.filter(pk=MODULE_ID).exists()
    assert OldIssue.objects.filter(pk=TASK_ID).exists()

    executor = MigrationExecutor(connection)
    executor.migrate([("source_control", "0001_initial")])
    migrated_apps = executor.loader.project_state(
        ("source_control", "0001_initial")
    ).apps
    HistoricalShipRecord = migrated_apps.get_model("source_control", "ShipRecord")
    assert HistoricalShipRecord.objects.count() == 0
    assert OldIssue.objects.filter(pk=MODULE_ID).exists()
    assert OldIssue.objects.filter(pk=TASK_ID).exists()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
