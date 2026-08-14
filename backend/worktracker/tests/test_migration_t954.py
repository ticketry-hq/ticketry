"""CODIN-954 — Module replaces the legacy module-level Epic issue type."""

import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0011_forcetransition"
AFTER = "0012_canonical_module_issue_type"


def _rewind():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, BEFORE)).apps


def _apply():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, AFTER)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def _project(apps, slug):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace, _ = Workspace.objects.get_or_create(
        slug="meml", defaults={"id": uuid.uuid4(), "name": "meml"}
    )
    return Project.objects.create(id=uuid.uuid4(), workspace=workspace, name=slug, slug=slug)


@pytest.mark.django_db(transaction=True)
def test_migration_renames_legacy_epic_and_preserves_module_parentage():
    old = _rewind()
    IssueType = old.get_model(APP, "IssueType")
    Issue = old.get_model(APP, "Issue")
    project = _project(old, "LEGACY")
    epic = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Epic", level="module", is_default=True
    )
    module = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="module", name="Module issue", sequence_id=1,
        issue_type=epic,
    )
    child = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="task", name="Child", sequence_id=2,
        parent=module,
    )

    new = _apply()
    NewIssueType = new.get_model(APP, "IssueType")
    NewIssue = new.get_model(APP, "Issue")
    canonical = NewIssueType.objects.get(project_id=project.id, name="Module")

    assert canonical.id == epic.id
    assert canonical.is_default is True
    assert NewIssue.objects.get(pk=module.id).type == "module"
    assert NewIssue.objects.get(pk=child.id).parent_id == module.id
    assert NewIssue.objects.get(pk=module.id).issue_type_id == canonical.id
    _restore_leaf()


@pytest.mark.django_db(transaction=True)
def test_migration_folds_epic_module_collision_and_is_idempotent():
    old = _rewind()
    IssueType = old.get_model(APP, "IssueType")
    Issue = old.get_model(APP, "Issue")
    project = _project(old, "COLLIDE")
    epic = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Epic", level="module", is_default=True
    )
    canonical = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module", is_default=False
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="module", name="Preserved", sequence_id=1,
        issue_type=epic,
    )

    new = _apply()
    NewIssueType = new.get_model(APP, "IssueType")
    NewIssue = new.get_model(APP, "Issue")
    migration = importlib.import_module(f"worktracker.migrations.{AFTER}")
    migration.migrate(new, None)

    assert not NewIssueType.objects.filter(pk=epic.id).exists()
    assert NewIssueType.objects.filter(project_id=project.id, name="Module", level="module").count() == 1
    assert NewIssueType.objects.get(pk=canonical.id).is_default is True
    assert NewIssue.objects.get(pk=issue.id).type == "module"
    assert NewIssue.objects.get(pk=issue.id).issue_type_id == canonical.id
    _restore_leaf()
