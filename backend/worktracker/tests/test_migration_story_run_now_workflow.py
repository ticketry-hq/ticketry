"""Migration coverage for the Story Run Now workflow edges."""

import importlib
import uuid
from types import SimpleNamespace

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0042_merge_singular_idea_state"
AFTER = "0043_story_run_now_workflow"


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


def _workflow_rows(apps, *, project, existing_agent_allowed):
    State = apps.get_model(APP, "State")
    IssueType = apps.get_model(APP, "IssueType")
    IssueTypeTransition = apps.get_model(APP, "IssueTypeTransition")
    ideas = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Ideas",
        group="backlog",
    )
    implement = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implement",
        group="started",
    )
    grill = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Grill",
        group="backlog",
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=ideas,
        workflow_revision=7,
    )
    implementation = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        start_state=implement,
        workflow_revision=3,
    )
    IssueTypeTransition.objects.create(
        issue_type=implementation,
        from_state=ideas,
        to_state=implement,
        agent_allowed=True,
    )
    if existing_agent_allowed is not None:
        IssueTypeTransition.objects.create(
            issue_type=story,
            from_state=ideas,
            to_state=implement,
            agent_allowed=existing_agent_allowed,
        )
    return story, implementation, ideas, implement, grill


def _workflow_missing_implement(apps, *, project):
    State = apps.get_model(APP, "State")
    IssueType = apps.get_model(APP, "IssueType")
    ideas = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ideas", group="backlog"
    )
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Grill", group="backlog"
    )
    return IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=ideas,
        workflow_revision=11,
    )


@pytest.mark.django_db(transaction=True)
def test_migration_adds_run_now_edges_and_advances_revision_once():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    existing = _workflow_rows(
        old,
        project=_project(old, slug="existing-edge"),
        existing_agent_allowed=False,
    )
    missing = _workflow_rows(
        old,
        project=_project(old, slug="missing-edge"),
        existing_agent_allowed=None,
    )
    incomplete = _workflow_missing_implement(
        old,
        project=_project(old, slug="missing-state"),
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    MigratedIssueType = new.get_model(APP, "IssueType")
    MigratedTransition = new.get_model(APP, "IssueTypeTransition")

    for story, implementation, ideas, implement, grill in (existing, missing):
        migrated_story = MigratedIssueType.objects.get(pk=story.id)
        assert migrated_story.workflow_revision == 8
        assert (
            MigratedTransition.objects.get(
                issue_type_id=story.id,
                from_state_id=ideas.id,
                to_state_id=implement.id,
            ).agent_allowed
            is True
        )
        assert (
            MigratedTransition.objects.get(
                issue_type_id=story.id,
                from_state_id=implement.id,
                to_state_id=grill.id,
            ).agent_allowed
            is True
        )

        migrated_implementation = MigratedIssueType.objects.get(pk=implementation.id)
        assert migrated_implementation.workflow_revision == 3
        assert (
            MigratedTransition.objects.get(
                issue_type_id=implementation.id,
                from_state_id=ideas.id,
                to_state_id=implement.id,
            ).agent_allowed
            is True
        )

    assert MigratedIssueType.objects.get(pk=incomplete.id).workflow_revision == 11
    assert not MigratedTransition.objects.filter(issue_type_id=incomplete.id).exists()

    migration = importlib.import_module(f"worktracker.migrations.{AFTER}")
    migration.add_story_run_now_transitions(
        new,
        SimpleNamespace(connection=connection),
    )
    for story, *_rest in (existing, missing):
        assert MigratedIssueType.objects.get(pk=story.id).workflow_revision == 8
    assert MigratedIssueType.objects.get(pk=incomplete.id).workflow_revision == 11

    executor.migrate(executor.loader.graph.leaf_nodes())
