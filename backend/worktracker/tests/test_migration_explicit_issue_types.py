"""The explicit-IssueType migration upgrades populated historical databases."""

import uuid

import pytest
from django.db import connection
from django.db.models.deletion import ProtectedError
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0032_canonical_issue_description"
AFTER = "0033_explicit_issue_types"


def _historical_project(apps, slug):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug=slug.lower(), name=slug.lower()
    )
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name=slug, slug=slug
    )


@pytest.mark.django_db(transaction=True)
def test_populated_upgrade_backfills_then_enforces_explicit_protected_type():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    project = _historical_project(old, "EXP")
    IssueType = old.get_model(APP, "IssueType")
    Issue = old.get_model(APP, "Issue")
    later_default = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Later",
        level="task",
        sort_order=20,
        is_default=True,
    )
    selected_default = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Selected",
        level="task",
        sort_order=10,
        is_default=True,
    )
    module_default = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Module",
        level="module",
        sort_order=0,
        is_default=True,
    )
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Historical untyped task",
        sequence_id=1,
        issue_type=None,
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="Historical untyped module",
        sequence_id=2,
        issue_type=None,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    NewIssue = new.get_model(APP, "Issue")
    NewIssueType = new.get_model(APP, "IssueType")

    assert NewIssue.objects.get(pk=task.id).issue_type_id == selected_default.id
    assert NewIssue.objects.get(pk=module.id).issue_type_id == module_default.id
    assert "is_default" not in {field.name for field in NewIssueType._meta.fields}
    with pytest.raises(ProtectedError):
        NewIssueType.objects.get(pk=selected_default.id).delete()
    assert NewIssueType.objects.filter(pk=later_default.id).exists()

    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_populated_upgrade_fails_clearly_without_a_level_type_default():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    project = _historical_project(old, "ERR")
    IssueType = old.get_model(APP, "IssueType")
    Issue = old.get_model(APP, "Issue")
    IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Not selected",
        level="task",
        is_default=False,
    )
    Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Cannot infer this type",
        sequence_id=1,
        issue_type=None,
    )

    with pytest.raises(RuntimeError, match="no configured default task IssueType"):
        MigrationExecutor(connection).migrate([(APP, AFTER)])

    # Repair the historical row so this test leaves the shared database at leaf.
    IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Selected",
        level="task",
        is_default=True,
    )
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
