import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0026_delete_legacy_workflow_models"
AFTER = "0027_launch_binding_subtree_run"


@pytest.mark.django_db(transaction=True)
def test_migration_enables_every_story_state_and_no_other_type():
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
        id=uuid.uuid4(), slug="subtree", name="Subtree"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Existing", slug="EXISTING"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    implementation = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    module_project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Module", slug="MODULE"
    )
    module_story = IssueType.objects.create(
        id=uuid.uuid4(), project=module_project, name="Story", level="module"
    )
    module_ready = State.objects.create(
        id=uuid.uuid4(),
        project=module_project,
        name="Ready",
        group="unstarted",
    )
    ready = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ready", group="unstarted"
    )
    custom = State.objects.create(
        id=uuid.uuid4(), project=project, name="Custom", group="started"
    )
    LaunchBinding.objects.create(
        issue_type=story, state=ready, prompt="Keep this prompt"
    )
    LaunchBinding.objects.create(
        issue_type=implementation, state=ready, prompt="Implement"
    )
    LaunchBinding.objects.create(
        issue_type=module_story, state=module_ready, prompt="Module"
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    story_rows = MigratedBinding.objects.filter(issue_type_id=story.id)
    assert set(story_rows.values_list("state_id", flat=True)) == {
        ready.id,
        custom.id,
    }
    assert not story_rows.filter(subtree_run_enabled=False).exists()
    assert story_rows.get(state_id=ready.id).prompt == "Keep this prompt"
    assert not MigratedBinding.objects.filter(
        issue_type_id__in=[implementation.id, module_story.id],
        subtree_run_enabled=True,
    ).exists()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
