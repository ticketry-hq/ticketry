import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0047_launch_binding_entry_skill"
AFTER = "0048_distinguish_workflow_state_colors"


@pytest.mark.django_db(transaction=True)
def test_migration_distinguishes_defaults_without_recoloring_custom_states():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")
    project = Project.objects.create(
        id=uuid.uuid4(),
        name="Migration",
        slug="COLOR-MIGRATION",
    )
    ideas = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Ideas",
        group="backlog",
        color="#D12771",
    )
    grill = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Grill",
        group="backlog",
        color="#60646c",
    )
    review = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Review",
        group="started",
        color="#D6409F",
    )
    custom_review = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Custom review",
        group="started",
        color="#D6409F",
    )
    customized_grill = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Grill",
        group="backlog",
        color="#123456",
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedState = new.get_model(APP, "State")

    assert MigratedState.objects.get(pk=ideas.pk).color == "#60646C"
    assert MigratedState.objects.get(pk=grill.pk).color == "#FA4D56"
    assert MigratedState.objects.get(pk=review.pk).color == "#08BDBA"
    assert MigratedState.objects.get(pk=custom_review.pk).color == "#D6409F"
    assert MigratedState.objects.get(pk=customized_grill.pk).color == "#123456"

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
