"""Regression coverage for legacy ``agent_runs`` schema convergence."""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "runs"
BEFORE = "0011_dismiss_historical_automation_failures"
AFTER = "0012_remove_legacy_agentrun_run_kind"


def _agent_run_columns() -> set[str]:
    with connection.cursor() as cursor:
        return {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, "agent_runs"
            )
        }


@pytest.mark.django_db(transaction=True)
def test_migration_removes_a_legacy_required_run_kind_column():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])

    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        cursor.execute(
            f"ALTER TABLE {quote('agent_runs')} "
            f"ADD COLUMN {quote('run_kind')} VARCHAR NOT NULL"
        )
    assert "run_kind" in _agent_run_columns()

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])

    assert "run_kind" not in _agent_run_columns()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
