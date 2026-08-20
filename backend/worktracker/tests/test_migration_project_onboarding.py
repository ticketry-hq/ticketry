import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0044_codex_5_6_model_catalog"
AFTER = "0045_project_onboarding_required"


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, target)])
    executor.loader.build_graph()
    return executor, executor.loader.project_state((APP, target)).apps


@pytest.mark.django_db(transaction=True)
def test_migration_moves_pending_onboarding_only_to_the_default_project():
    _executor, old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="meml", name="meml", onboarding_required=True
    )
    extra = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Extra", slug="EXT"
    )
    default = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Coding", slug="CDN"
    )

    executor, new = _migrate(AFTER)
    MigratedProject = new.get_model(APP, "Project")

    assert MigratedProject.objects.get(pk=default.id).onboarding_required is True
    assert MigratedProject.objects.get(pk=extra.id).onboarding_required is False
    assert MigratedProject.objects.count() == 2
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_migration_preserves_acknowledged_install_and_all_project_rows():
    _executor, old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="meml", name="meml", onboarding_required=False
    )
    project_ids = [uuid.uuid4(), uuid.uuid4()]
    for project_id, slug in zip(project_ids, ("ONE", "TWO"), strict=True):
        Project.objects.create(
            id=project_id, workspace=workspace, name=slug, slug=slug
        )

    executor, new = _migrate(AFTER)
    MigratedProject = new.get_model(APP, "Project")

    assert set(MigratedProject.objects.values_list("id", flat=True)) == set(project_ids)
    assert not MigratedProject.objects.filter(onboarding_required=True).exists()
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_migration_flags_the_runtime_default_across_workspaces():
    _executor, old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    first_workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="first", name="First", onboarding_required=True
    )
    second_workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="second", name="Second", onboarding_required=False
    )
    extra = Project.objects.create(
        id=uuid.uuid4(), workspace=first_workspace, name="Extra", slug="EXT"
    )
    default = Project.objects.create(
        id=uuid.uuid4(), workspace=second_workspace, name="Coding", slug="CDN"
    )

    executor, _new = _migrate(AFTER)
    executor.migrate(executor.loader.graph.leaf_nodes())

    from worktracker.models import Project as RuntimeProject
    from worktracker.services.onboarding import get_installation_default_project

    assert get_installation_default_project().pk == default.id
    assert RuntimeProject.objects.get(pk=default.id).onboarding_required is True
    assert RuntimeProject.objects.get(pk=extra.id).onboarding_required is False
    assert RuntimeProject.objects.filter(onboarding_required=True).count() == 1
