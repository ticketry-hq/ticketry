"""CODIN-1137 — workflow-state colors become complete and durable."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0016_workflow_configuration"
AFTER = "0017_complete_workflow_state_colors"
CARBON_DARK_PALETTE = {
    "#8A3FFC",
    "#33B1FF",
    "#007D79",
    "#FF7EB6",
    "#FA4D56",
    "#FFF1F1",
    "#6FDC8C",
    "#4589FF",
    "#D12771",
    "#D2A106",
    "#08BDBA",
    "#BAE6FF",
    "#BA4E00",
    "#D4BBFF",
}


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, target)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, target)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def _project(apps, *, slug):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug=slug, name=slug)
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name=slug, slug=slug.upper()
    )


@pytest.mark.django_db(transaction=True)
def test_backfill_preserves_configured_colors_and_completes_blank_states():
    old = _migrate(BEFORE)
    State = old.get_model(APP, "State")
    project = _project(old, slug="colors")

    idea = State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog", color=""
    )
    configured = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Done",
        group="completed",
        color="#cUsToM",
    )
    occupied = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Occupied",
        group="started",
        color="#8a3ffc",
    )
    first_blank = State.objects.create(
        id=uuid.uuid4(), project=project, name="QA", group="started", color=""
    )
    second_blank = State.objects.create(
        id=uuid.uuid4(), project=project, name="Deploy", group="started", color=""
    )

    new = _migrate(AFTER)
    NewState = new.get_model(APP, "State")

    assert NewState.objects.get(pk=idea.id).color == "#60646C"
    assert NewState.objects.get(pk=configured.id).color == "#cUsToM"
    assert NewState.objects.get(pk=occupied.id).color == "#8a3ffc"
    assigned = {
        NewState.objects.get(pk=first_blank.id).color,
        NewState.objects.get(pk=second_blank.id).color,
    }
    assert len(assigned) == 2
    assert assigned <= CARBON_DARK_PALETTE
    assert "#8A3FFC" not in assigned
    _restore_leaf()


@pytest.mark.django_db(transaction=True)
def test_backfill_capacity_failure_is_atomic_and_diagnostic():
    old = _migrate(BEFORE)
    State = old.get_model(APP, "State")
    project = _project(old, slug="overflow")
    rows = [
        State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Idea" if index == 0 else f"Custom {index}",
            group="backlog",
            color="",
        )
        for index in range(16)
    ]

    with pytest.raises(RuntimeError, match=r"project OVERFLOW .*15 blank.*14 unused"):
        _migrate(AFTER)

    assert list(
        State.objects.filter(id__in=[row.id for row in rows]).values_list(
            "color", flat=True
        )
    ) == [""] * len(rows)

    State.objects.filter(project_id=project.id).delete()
    _restore_leaf()
