"""CODIN-1048 — work-item priority is removed with intentional value loss."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0014_workspace_onboarding_required"
AFTER = "0015_remove_issue_priority"


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, target)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, target)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_priority_column_is_removed_and_rollback_restores_none_default():
    old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    Issue = old.get_model(APP, "Issue")
    IssueType = old.get_model(APP, "IssueType")
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="old", name="Old")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Old", slug="OLD"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        is_default=True,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Prioritized",
        sequence_id=1,
        priority="urgent",
        issue_type=task_type,
    )

    new = _migrate(AFTER)
    NewIssue = new.get_model(APP, "Issue")
    assert "priority" not in {field.name for field in NewIssue._meta.fields}
    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, "worktracker_issue"
            )
        }
    assert "priority" not in columns

    restored = _migrate(BEFORE)
    RestoredIssue = restored.get_model(APP, "Issue")
    assert "priority" in {field.name for field in RestoredIssue._meta.fields}
    assert RestoredIssue.objects.get(pk=issue.id).priority == "none"
    _restore_leaf()
