"""CODIN-859 — the 0010 migration reshapes every project to the canonical
seven-state SDLC taxonomy on real, historically-shaped data.

Uses Django's MigrationExecutor against historical model states so the schema at
each step is exactly what a deployed install sees. Asserts externally observable
outcomes (final state set, groups, protection, issue reassignment, type
repointing) rather than migration internals.
"""

import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

APP = "worktracker"
BEFORE = "0009_issue_lifecycle_state"
AFTER = "0010_workflow_taxonomy"

# The exact live meml shape before the migration.
LIVE_STATES = [
    ("Backlog", "backlog"),
    ("Todo", "unstarted"),
    ("LLD", "unstarted"),
    ("HLD", "unstarted"),
    ("Blocked", "unstarted"),
    ("In Progress", "started"),
    ("Done", "completed"),
    ("Cancelled", "cancelled"),
]

CANONICAL_ORDER = [
    "Idea",
    "Refinement",
    "Ready",
    "Implement",
    "Review",
    "Done",
    "Cancelled",
]

CANONICAL_GROUP = {
    "Idea": "backlog",
    "Refinement": "unstarted",
    "Ready": "unstarted",
    "Implement": "started",
    "Review": "started",
    "Done": "completed",
    "Cancelled": "cancelled",
}


def _rewind_to_before():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, BEFORE)).apps


def _apply_after():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    return executor.loader.project_state((APP, AFTER)).apps


def _restore_leaf():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def _seed_live_project(apps, slug="MEML"):
    """Create a project with the live pre-859 state + type shape and return ids."""
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    State = apps.get_model(APP, "State")
    IssueType = apps.get_model(APP, "IssueType")
    Issue = apps.get_model(APP, "Issue")

    ws, _ = Workspace.objects.get_or_create(
        slug="meml", defaults={"id": uuid.uuid4(), "name": "meml"}
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name=slug, slug=slug
    )
    states = {}
    for name, group in LIVE_STATES:
        states[name] = State.objects.create(
            id=uuid.uuid4(), project=project, name=name, group=group
        )

    # The historical two-type seed (Epic module-default, Task task-default).
    epic = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Epic", level="module",
        sort_order=0, is_default=True,
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task",
        sort_order=1, is_default=True,
    )

    # Issues parked in the states that must fold into Refinement, plus a Task.
    parked = {}
    for i, name in enumerate(["LLD", "HLD", "Blocked"]):
        parked[name] = Issue.objects.create(
            id=uuid.uuid4(), project=project, type="task", name=f"{name}-issue",
            sequence_id=i + 1, state=states[name], issue_type=task_type,
        )
    return project, states, task_type, parked


@pytest.mark.django_db(transaction=True)
def test_migration_folds_live_shape_to_canonical():
    old = _rewind_to_before()
    project, states, task_type, parked = _seed_live_project(old)

    new = _apply_after()
    State = new.get_model(APP, "State")
    Issue = new.get_model(APP, "Issue")
    IssueType = new.get_model(APP, "IssueType")

    rows = list(
        State.objects.filter(project_id=project.id).order_by("sort_order")
    )
    # Exactly the seven canonical states, in canonical order.
    assert [s.name for s in rows] == CANONICAL_ORDER
    assert [s.sort_order for s in rows] == list(range(7))
    # Correct groups, all protected, all colored.
    for s in rows:
        assert s.group == CANONICAL_GROUP[s.name]
        assert s.is_protected is True
        assert s.color

    # The folded rows are gone.
    names = {s.name for s in rows}
    assert not (names & {"Backlog", "Todo", "LLD", "HLD", "Blocked", "In Progress"})

    # Every issue parked in LLD / HLD / Blocked now points at Refinement.
    refinement = State.objects.get(project_id=project.id, name="Refinement")
    for issue in parked.values():
        assert Issue.objects.get(pk=issue.id).state_id == refinement.id

    # No issue references a deleted state.
    valid_state_ids = set(
        State.objects.filter(project_id=project.id).values_list("id", flat=True)
    )
    for issue in Issue.objects.filter(project_id=project.id):
        assert issue.state_id in valid_state_ids

    # Types: Task retired, its issues repointed to Story; Story the lone task
    # default, Epic the module default.
    types = {t.name: t for t in IssueType.objects.filter(project_id=project.id)}
    assert set(types) == {"Epic", "Story", "PathFind", "Implementation"}
    assert types["Story"].is_default and types["Story"].level == "task"
    assert types["Epic"].is_default and types["Epic"].level == "module"
    assert not types["PathFind"].is_default and not types["Implementation"].is_default
    for issue in parked.values():
        assert Issue.objects.get(pk=issue.id).issue_type_id == types["Story"].id

    _restore_leaf()


@pytest.mark.django_db(transaction=True)
def test_migration_is_idempotent_and_stable_under_provision():
    old = _rewind_to_before()
    project, *_ = _seed_live_project(old)

    new = _apply_after()
    State = new.get_model(APP, "State")
    IssueType = new.get_model(APP, "IssueType")

    first_orders = list(
        State.objects.filter(project_id=project.id)
        .order_by("sort_order")
        .values_list("name", "sort_order")
    )

    # Re-run the migration data step (models are the same historical classes).
    migration = importlib.import_module(f"worktracker.migrations.{AFTER}")
    migration.migrate(new, None)

    # No duplicate Ready / Review, same seven states, same sort_order.
    for name in ("Ready", "Review"):
        assert State.objects.filter(project_id=project.id, name=name).count() == 1
    assert State.objects.filter(project_id=project.id).count() == 7
    assert IssueType.objects.filter(project_id=project.id).count() == 4
    second_orders = list(
        State.objects.filter(project_id=project.id)
        .order_by("sort_order")
        .values_list("name", "sort_order")
    )
    assert first_orders == second_orders

    _restore_leaf()


@pytest.mark.django_db(transaction=True)
def test_migration_on_project_with_preexisting_ready_review_and_story():
    old = _rewind_to_before()
    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    State = old.get_model(APP, "State")
    IssueType = old.get_model(APP, "IssueType")
    Issue = old.get_model(APP, "Issue")

    ws, _ = Workspace.objects.get_or_create(
        slug="meml", defaults={"id": uuid.uuid4(), "name": "meml"}
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="CUST", slug="CUST"
    )
    # A partially-customized project that already has Ready + Review, plus a
    # custom task-level Story the migration must reuse (not duplicate).
    for name, group in [
        ("Backlog", "backlog"),
        ("Ready", "unstarted"),
        ("In Progress", "started"),
        ("Review", "started"),
        ("Done", "completed"),
        ("Cancelled", "cancelled"),
    ]:
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)
    IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Epic", level="module",
        sort_order=0, is_default=True,
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task",
        sort_order=1, is_default=True,
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task",
        sort_order=2, is_default=False,
    )
    tasked = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="task", name="old-task",
        sequence_id=1, issue_type=task_type,
    )

    new = _apply_after()
    NewState = new.get_model(APP, "State")
    NewIssue = new.get_model(APP, "Issue")
    NewIssueType = new.get_model(APP, "IssueType")

    # No duplicate Ready / Review despite pre-existing rows.
    for name in ("Ready", "Review"):
        assert NewState.objects.filter(project_id=project.id, name=name).count() == 1
    assert [s.name for s in NewState.objects.filter(project_id=project.id).order_by(
        "sort_order"
    )] == CANONICAL_ORDER

    # The pre-existing Story is reused (no duplicate), and the old Task issue is
    # repointed to it before Task is retired.
    assert NewIssueType.objects.filter(
        project_id=project.id, name="Story"
    ).count() == 1
    assert not NewIssueType.objects.filter(
        project_id=project.id, name="Task"
    ).exists()
    assert NewIssue.objects.get(pk=tasked.id).issue_type_id == story.id

    _restore_leaf()
