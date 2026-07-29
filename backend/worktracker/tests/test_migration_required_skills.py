import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0027_launch_binding_subtree_run"
AFTER = "0028_launch_binding_required_skills"
MIGRATION = importlib.import_module(
    "worktracker.migrations.0028_launch_binding_required_skills"
)


@pytest.mark.django_db(transaction=True)
def test_migration_seeds_default_derived_bindings_without_rewriting_user_prompts():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    LaunchBinding = old.get_model(APP, "LaunchBinding")

    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="seed", name="Seed")
    project = Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name="Seed",
        slug="SEED",
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
    )
    implementation = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
    )
    idea = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Idea",
        group="backlog",
    )
    refinement = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Refinement",
        group="unstarted",
    )

    LaunchBinding.objects.create(
        issue_type=story,
        state=idea,
        prompt=MIGRATION.IDEA_PROMPT,
    )
    LaunchBinding.objects.create(
        issue_type=story,
        state=refinement,
        prompt=MIGRATION.OLD_REFINEMENT_PROMPT,
    )
    customized_prompt = MIGRATION.OLD_REFINEMENT_PROMPT + "\nKeep my edit."
    LaunchBinding.objects.create(
        issue_type=implementation,
        state=refinement,
        prompt=customized_prompt,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    migrated_idea = MigratedBinding.objects.get(
        issue_type_id=story.id,
        state_id=idea.id,
    )
    migrated_refinement = MigratedBinding.objects.get(
        issue_type_id=story.id,
        state_id=refinement.id,
    )
    customized = MigratedBinding.objects.get(
        issue_type_id=implementation.id,
        state_id=refinement.id,
    )
    assert migrated_idea.required_skills == ["to-spec", "to-tickets"]
    assert migrated_refinement.required_skills == [
        "grill-with-docs",
        "to-spec",
        "to-tickets",
    ]
    assert migrated_refinement.prompt == MIGRATION.REFINEMENT_PROMPT
    assert customized.prompt == customized_prompt
    assert customized.required_skills == []

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
