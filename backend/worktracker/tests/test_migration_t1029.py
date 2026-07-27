"""CODIN-1029 — existing workspaces do not enter first-run onboarding."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0013_remove_sprint_vertical"
AFTER = "0014_workspace_onboarding_required"


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, target)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, target)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_existing_workspaces_are_backfilled_as_not_requiring_onboarding():
    old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="existing", name="Existing"
    )

    new = _migrate(AFTER)
    NewWorkspace = new.get_model(APP, "Workspace")

    assert NewWorkspace.objects.get(pk=workspace.id).onboarding_required is False
    _restore_leaf()
