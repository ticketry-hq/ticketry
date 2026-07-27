import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0018_launch_binding"
AFTER = "0019_refresh_default_launch_prompts"
MIGRATION = importlib.import_module(
    "worktracker.migrations.0019_refresh_default_launch_prompts"
)


@pytest.mark.django_db(transaction=True)
def test_migration_refreshes_only_unchanged_default_prompts():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    IssueType = old.get_model(APP, "IssueType")
    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")
    Workspace = old.get_model(APP, "Workspace")
    LaunchBinding = old.get_model(APP, "LaunchBinding")
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="seed", name="Seed")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Seed", slug="SEED"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    implementation = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    idea = State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog"
    )

    LaunchBinding.objects.create(
        issue_type=story,
        state=idea,
        prompt=MIGRATION.OLD_AGENT_PROMPTS["Idea"],
    )
    LaunchBinding.objects.create(
        issue_type=implementation,
        state=idea,
        prompt="Keep this custom prompt.",
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    LaunchBinding = new.get_model(APP, "LaunchBinding")

    seeded = LaunchBinding.objects.get(issue_type_id=story.id, state_id=idea.id)
    customized = LaunchBinding.objects.get(
        issue_type_id=implementation.id, state_id=idea.id
    )
    assert seeded.prompt == MIGRATION.NEW_AGENT_PROMPTS["Idea"]
    assert customized.prompt == "Keep this custom prompt."

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
