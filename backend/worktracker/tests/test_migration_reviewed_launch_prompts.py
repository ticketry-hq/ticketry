import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from worktracker.launch_seeds import DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE


APP = "worktracker"
BEFORE = "0028_launch_binding_required_skills"
AFTER = "0029_sync_reviewed_launch_prompts"
MIGRATION = importlib.import_module(
    "worktracker.migrations.0029_sync_reviewed_launch_prompts"
)


@pytest.mark.django_db(transaction=True)
def test_migration_syncs_seeded_prompts_by_type_without_overwriting_custom_prompts():
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
        id=uuid.uuid4(), slug="reviewed", name="Reviewed"
    )
    project = Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name="Existing",
        slug="EXISTING",
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    implementation = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    pathfind = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="PathFind", level="task"
    )
    idea = State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog"
    )
    implement = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    done = State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )

    LaunchBinding.objects.create(
        issue_type=story,
        state=idea,
        prompt=MIGRATION.PREVIOUS_DEFAULT_PROMPTS["Idea"],
    )
    LaunchBinding.objects.create(
        issue_type=implementation,
        state=implement,
        prompt=MIGRATION.PREVIOUS_DEFAULT_PROMPTS["Implement"],
    )
    LaunchBinding.objects.create(
        issue_type=pathfind,
        state=done,
        prompt=MIGRATION.PREVIOUS_DEFAULT_PROMPTS["Done"],
    )
    custom_prompt = MIGRATION.PREVIOUS_DEFAULT_PROMPTS["Idea"] + "\nKeep my edit."
    LaunchBinding.objects.create(
        issue_type=implementation,
        state=idea,
        prompt=custom_prompt,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    assert MigratedBinding.objects.get(
        issue_type_id=story.id, state_id=idea.id
    ).prompt == MIGRATION.PREVIOUS_DEFAULT_PROMPTS["Idea"]
    assert MigratedBinding.objects.get(
        issue_type_id=implementation.id, state_id=implement.id
    ).prompt == DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE["Implementation"]["Implement"]
    assert MigratedBinding.objects.get(
        issue_type_id=pathfind.id, state_id=done.id
    ).prompt == DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE["PathFind"]["Done"]
    assert (
        MigratedBinding.objects.get(
            issue_type_id=implementation.id, state_id=idea.id
        ).prompt
        == custom_prompt
    )

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
