import copy
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0024_migrate_shared_workflow_settings"
AFTER = "0025_per_type_transitions"


def _edge(source, target, *, auto_launch=False):
    return {
        "from": str(source.id),
        "to": str(target.id),
        "auto_launch": auto_launch,
    }


@pytest.mark.django_db(transaction=True)
def test_migration_materializes_each_types_active_transition_map():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    WorkflowConfiguration = old.get_model(APP, "WorkflowConfiguration")
    LaunchBinding = old.get_model(APP, "LaunchBinding")

    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="per-type-migration", name="Migration"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Migration", slug="MIG"
    )
    inherited = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    overridden = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Bug", level="task"
    )
    ready = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ready", group="unstarted"
    )
    build = State.objects.create(
        id=uuid.uuid4(), project=project, name="Build", group="started"
    )
    review = State.objects.create(
        id=uuid.uuid4(), project=project, name="Review", group="started"
    )
    done = State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )

    inherited_edges = [
        _edge(ready, build, auto_launch=True),
        _edge(build, review),
        _edge(review, done),
    ]
    overridden_edges = [
        _edge(ready, review, auto_launch=True),
        _edge(review, done),
    ]
    WorkflowConfiguration.objects.create(
        issue_type=inherited,
        active={
            "start_state_id": str(ready.id),
            "terminal_state_ids": [str(done.id)],
            "edges": copy.deepcopy(inherited_edges),
        },
        transition_override=None,
        revision=7,
    )
    WorkflowConfiguration.objects.create(
        issue_type=overridden,
        active={
            "start_state_id": str(review.id),
            "terminal_state_ids": [str(done.id)],
            "edges": copy.deepcopy(overridden_edges),
        },
        transition_override=copy.deepcopy(overridden_edges),
        revision=4,
    )
    LaunchBinding.objects.create(
        issue_type=inherited, state=build, prompt="Build it", agent="codex"
    )
    LaunchBinding.objects.create(
        issue_type=overridden, state=review, prompt="Review it", agent="codex"
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    NewIssueType = new.get_model(APP, "IssueType")
    IssueTypeTransition = new.get_model(APP, "IssueTypeTransition")
    NewLaunchBinding = new.get_model(APP, "LaunchBinding")

    assert NewIssueType.objects.get(pk=inherited.id).start_state_id == ready.id
    assert NewIssueType.objects.get(pk=overridden.id).start_state_id == review.id
    assert NewIssueType.objects.get(pk=inherited.id).workflow_revision == 7
    assert NewIssueType.objects.get(pk=overridden.id).workflow_revision == 4

    def rows(issue_type):
        return {
            (str(row.from_state_id), str(row.to_state_id), row.agent_allowed)
            for row in IssueTypeTransition.objects.filter(issue_type_id=issue_type.id)
        }

    assert rows(inherited) == {
        (edge["from"], edge["to"], True) for edge in inherited_edges
    }
    assert rows(overridden) == {
        (edge["from"], edge["to"], True) for edge in overridden_edges
    }
    assert NewLaunchBinding.objects.get(
        issue_type_id=inherited.id, state_id=build.id
    ).auto_start is True
    assert NewLaunchBinding.objects.get(
        issue_type_id=overridden.id, state_id=review.id
    ).auto_start is True

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
