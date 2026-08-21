"""0050 moves manual module ranks into presentation records."""

import uuid

import pytest
from django.core.exceptions import FieldDoesNotExist
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0049_issue_workspace_tab_order"
AFTER = "0050_module_presentation"


def make_project(apps, slug, *, manual):
    Project = apps.get_model(APP, "Project")
    return Project.objects.create(
        id=uuid.uuid4(),
        name=slug,
        slug=slug,
        manual_module_order=manual,
    )


def make_module(apps, project, name, sequence_id, rank):
    IssueType = apps.get_model(APP, "IssueType")
    Issue = apps.get_model(APP, "Issue")
    module_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Module",
        defaults={"id": uuid.uuid4(), "level": "module"},
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=module_type,
        type="module",
        name=name,
        sequence_id=sequence_id,
        rank=rank,
    )


@pytest.mark.django_db(transaction=True)
def test_manual_ranks_are_preserved_while_automatic_projects_stay_rowless():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    manual = make_project(old, "MAN", manual=True)
    automatic = make_project(old, "AUT", manual=False)
    first = make_module(old, manual, "first", 1, "A")
    last = make_module(old, manual, "last", 2, "Z")
    make_module(old, automatic, "automatic", 1, "M")

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    Project = new.get_model(APP, "Project")
    ModulePresentation = new.get_model(APP, "ModulePresentation")
    with pytest.raises(FieldDoesNotExist):
        Project._meta.get_field("manual_module_order")
    assert dict(
        ModulePresentation.objects.filter(module__project_id=manual.id).values_list(
            "module_id", "rank"
        )
    ) == {first.id: "A", last.id: "Z"}
    assert not ModulePresentation.objects.filter(
        module__project_id=automatic.id
    ).exists()

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
