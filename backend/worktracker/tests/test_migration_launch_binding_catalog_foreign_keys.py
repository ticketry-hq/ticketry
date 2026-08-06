import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0037_provider_catalog"
AFTER = "0038_launch_binding_catalog_foreign_keys"


@pytest.mark.django_db(transaction=True)
def test_migration_maps_every_binding_and_creates_rows_for_unknown_values():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    LaunchBinding = old.get_model(APP, "LaunchBinding")

    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="migration", name="Migration"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Migration", slug="MIGRATION"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    first_state = State.objects.create(
        id=uuid.uuid4(), project=project, name="First", group="started"
    )
    second_state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Second", group="started"
    )
    known = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=first_state,
        prompt="Known",
        agent="claude",
        model="sonnet",
        reasoning="high",
    )
    unknown = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=second_state,
        prompt="Unknown",
        agent="custom-provider",
        model="custom-model",
        reasoning="deliberate",
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    assert MigratedBinding.objects.count() == 2
    migrated_known = MigratedBinding.objects.get(pk=known.pk)
    migrated_unknown = MigratedBinding.objects.get(pk=unknown.pk)
    assert migrated_known.model.name == "sonnet"
    assert migrated_known.model.provider.slug == "claude"
    assert migrated_known.reasoning.name == "high"
    assert migrated_unknown.model.name == "custom-model"
    assert migrated_unknown.model.provider.slug == "custom-provider"
    assert migrated_unknown.reasoning.name == "deliberate"
    assert migrated_unknown.model.permitted_reasoning_levels.filter(
        pk=migrated_unknown.reasoning_id
    ).exists()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
