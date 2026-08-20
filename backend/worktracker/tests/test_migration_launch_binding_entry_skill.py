import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0046_remove_workspace"
AFTER = "0047_launch_binding_entry_skill"


@pytest.mark.django_db(transaction=True)
def test_migration_sets_entry_skills_only_on_matching_reviewed_bindings():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Project = old.get_model(APP, "Project")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    LaunchBinding = old.get_model(APP, "LaunchBinding")

    project = Project.objects.create(
        id=uuid.uuid4(),
        name="Migration",
        slug="MIGRATION",
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    custom_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Incident", level="task"
    )
    spec = State.objects.create(
        id=uuid.uuid4(), project=project, name="Spec", group="unstarted"
    )
    reviewed = LaunchBinding.objects.create(
        issue_type=story,
        state=spec,
        prompt="Use to-spec.",
        required_skills=["to-spec"],
    )
    missing_requirement = LaunchBinding.objects.create(
        issue_type=custom_type,
        state=spec,
        prompt="Custom binding.",
        required_skills=[],
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    assert MigratedBinding.objects.get(pk=reviewed.pk).entry_skill == "to-spec"
    assert MigratedBinding.objects.get(pk=missing_requirement.pk).entry_skill is None

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
