"""0041 gives every project an ordering mode without touching module ranks."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0040_story_ideas_intake"
AFTER = "0041_project_manual_module_order"


def _project(apps, *, slug):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug=f"{slug}-workspace",
        name=f"{slug} workspace",
    )
    return Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        slug=slug,
        name=slug,
    )


@pytest.mark.django_db(transaction=True)
def test_existing_projects_default_to_automatic_and_keep_their_module_ranks():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Issue = old.get_model(APP, "Issue")
    IssueType = old.get_model(APP, "IssueType")
    project = _project(old, slug="ord")
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    ranks = {}
    for sequence_id, rank in enumerate(("QZQZQZQZ", "8r8r8r8r", "iHiHiHiH"), start=1):
        module = Issue.objects.create(
            id=uuid.uuid4(),
            project=project,
            issue_type=module_type,
            type="module",
            name=f"module-{sequence_id}",
            sequence_id=sequence_id,
            rank=rank,
        )
        ranks[module.id] = rank

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    migrated = new.get_model(APP, "Project").objects.get(pk=project.id)
    assert migrated.manual_module_order is False

    NewIssue = new.get_model(APP, "Issue")
    assert {
        module.id: module.rank
        for module in NewIssue.objects.filter(project_id=project.id)
    } == ranks

    # Restore to the leaf so later tests in the run see every table.
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
