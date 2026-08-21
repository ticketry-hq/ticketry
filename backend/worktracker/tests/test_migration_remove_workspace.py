import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0045_project_onboarding_required"
AFTER = "0046_remove_workspace"


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, target)])
    executor.loader.build_graph()
    return executor, executor.loader.project_state((APP, target)).apps


@pytest.mark.django_db(transaction=True)
def test_migration_preserves_projects_and_resolves_cross_workspace_slug_collisions():
    _executor, old = _migrate(BEFORE)
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    first_workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="first", name="First"
    )
    second_workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="second", name="Second"
    )
    project_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    Project.objects.create(
        id=project_ids[0],
        workspace=first_workspace,
        name="Default",
        slug="CDN",
        onboarding_required=True,
    )
    Project.objects.create(
        id=project_ids[1], workspace=second_workspace, name="Collision", slug="CDN"
    )
    Project.objects.create(
        id=project_ids[2], workspace=second_workspace, name="Other", slug="OTH"
    )
    Project.objects.create(
        id=project_ids[3], workspace=second_workspace, name="Reserved", slug="CDN-2"
    )

    executor, new = _migrate(AFTER)
    MigratedProject = new.get_model(APP, "Project")

    rows = list(MigratedProject.objects.order_by("created_at", "id"))
    assert {row.id for row in rows} == set(project_ids)
    assert len({row.slug for row in rows}) == 4
    assert MigratedProject.objects.get(pk=project_ids[0]).onboarding_required is True
    assert "workspace" not in {field.name for field in MigratedProject._meta.fields}
    with pytest.raises(LookupError):
        new.get_model(APP, "Workspace")
    executor.migrate(executor.loader.graph.leaf_nodes())
