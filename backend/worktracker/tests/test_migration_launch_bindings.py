import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0017_complete_workflow_state_colors"
AFTER = "0018_launch_binding"


@pytest.mark.django_db(transaction=True)
def test_migration_seeds_only_existing_canonical_type_state_pairs():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="seed", name="Seed")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Seed", slug="SEED"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    custom_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Incident", level="task"
    )
    implement = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    custom_state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Mitigating", group="started"
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    LaunchBinding = new.get_model(APP, "LaunchBinding")

    binding = LaunchBinding.objects.get(issue_type_id=story.id, state_id=implement.id)
    assert binding.prompt.startswith("This task is in `Implement`:")
    assert not LaunchBinding.objects.filter(issue_type_id=custom_type.id).exists()
    assert not LaunchBinding.objects.filter(state_id=custom_state.id).exists()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
