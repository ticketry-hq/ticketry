"""Service-level tests for the framework-neutral work item boundary."""

import uuid

import pytest

from worktracker.models import (
    Issue,
    IssueType,
    IssueTypeTransition,
    Project,
    State,
)
from worktracker.services.errors import ServiceError, ValidationError
from worktracker.services.work_items import (
    create_module_work_item,
    create_project_work_item,
    delete_work_item,
    reorder_work_item,
    update_work_item,
)
from worktracker.workflow import InvalidTransition


def _issue(*, project, type="task", **data):
    issue_type = data.pop("issue_type", None)
    if issue_type is None:
        issue_type, _ = IssueType.objects.get_or_create(
            project=project,
            name=f"Test {type}",
            defaults={"id": uuid.uuid4(), "level": type},
        )
    return Issue.objects.create(
        project=project, type=type, issue_type=issue_type, **data
    )


@pytest.mark.django_db
def test_create_project_work_item_requires_explicit_type(project, task_type):
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    issue = create_project_work_item(
        project.id, name="New", issue_type_id=task_type.id
    )

    assert issue.project_id == project.id
    assert issue.sequence_id == 1
    assert issue.rank != ""
    assert issue.state_id == backlog.id
    assert issue.issue_type_id == task_type.id


@pytest.mark.django_db
def test_create_project_work_item_honors_explicit_state_and_type(project):
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Task",
        level="task",
    )

    issue = create_project_work_item(
        project.id,
        name="New",
        state_id=backlog.id,
        issue_type_id=task_type.id,
        description="hello",
    )

    assert issue.state_id == backlog.id
    assert issue.issue_type_id == task_type.id
    assert issue.description == "hello"


@pytest.mark.django_db
def test_create_project_work_item_missing_project_raises():
    with pytest.raises(ServiceError) as excinfo:
        create_project_work_item(
            uuid.uuid4(), name="New", issue_type_id=uuid.uuid4()
        )

    assert excinfo.value.status_code == 404


@pytest.mark.django_db
def test_create_project_work_item_rejects_wrong_level(project):
    module_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Epic",
        level="module",
    )

    with pytest.raises(ValidationError) as excinfo:
        create_project_work_item(
            project.id,
            name="New",
            issue_type_id=module_type.id,
        )

    assert excinfo.value.status_code == 422


@pytest.mark.django_db
def test_create_gated_type_rejects_foreign_birth_state(project):
    """#870: a Story cannot be *born* in Done — birth is gated like the move."""

    idea = State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog"
    )
    done = State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )
    story_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=idea,
        workflow_revision=1,
    )
    with pytest.raises(InvalidTransition) as excinfo:
        create_project_work_item(
            project.id, name="New", issue_type_id=story_type.id, state_id=done.id
        )

    assert excinfo.value.code == "illegal_birth"
    assert not Issue.objects.filter(project=project, name="New").exists()


@pytest.mark.django_db
def test_create_module_implementation_born_ready_not_default(project):
    """#870: module-scoped create resolves the type before the state, so an
    Implementation is born Ready instead of stranded in the Idea default."""

    State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog"
    )
    ready = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ready", group="unstarted"
    )
    impl_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        start_state=ready,
        workflow_revision=1,
    )
    module = _issue(
        id=uuid.uuid4(), project=project, type="module", name="M", sequence_id=999
    )

    issue = create_module_work_item(
        module.id, name="Child", issue_type_id=impl_type.id
    )

    assert issue.state_id == ready.id


@pytest.mark.django_db
def test_create_module_work_item_sets_module_ancestor(project):
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )
    module = _issue(
        id=uuid.uuid4(), project=project, type="module", name="M", sequence_id=999
    )

    issue = create_module_work_item(module.id, name="Child", issue_type_id=task_type.id)

    assert issue.module_id == module.id


@pytest.mark.django_db
def test_create_project_work_item_resolves_module_through_deep_subtasks(
    project, task_type
):
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    module = _issue(
        id=uuid.uuid4(), project=project, type="module", name="M", sequence_id=999
    )
    parent = module
    for depth in range(1, 4):
        parent = create_project_work_item(
            project.id,
            name=f"Level {depth}",
            issue_type_id=task_type.id,
            parent_id=parent.id,
        )

    assert parent.module_id == module.id


@pytest.mark.django_db
def test_reparent_work_item_rewrites_module_on_descendant_subtree(project, task_type):
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    module_a = _issue(
        id=uuid.uuid4(), project=project, type="module", name="A", sequence_id=998
    )
    module_b = _issue(
        id=uuid.uuid4(), project=project, type="module", name="B", sequence_id=999
    )
    root = create_project_work_item(
        project.id,
        name="Root",
        issue_type_id=task_type.id,
        parent_id=module_a.id,
    )
    child = create_project_work_item(
        project.id,
        name="Child",
        issue_type_id=task_type.id,
        parent_id=root.id,
    )
    grandchild = create_project_work_item(
        project.id,
        name="Grandchild",
        issue_type_id=task_type.id,
        parent_id=child.id,
    )

    update_work_item(root.id, parent_id=module_b.id)

    module_ids = set(
        Issue.objects.filter(id__in=[root.id, child.id, grandchild.id]).values_list(
            "module_id", flat=True
        )
    )
    assert module_ids == {module_b.id}


@pytest.mark.django_db
def test_reparent_module_preserves_module_on_descendant_subtree(project):
    module = _issue(
        id=uuid.uuid4(), project=project, type="module", name="M", sequence_id=997
    )
    child = _issue(
        id=uuid.uuid4(),
        project=project,
        name="Child",
        sequence_id=998,
        parent=module,
        module=module,
    )
    grandchild = _issue(
        id=uuid.uuid4(),
        project=project,
        name="Grandchild",
        sequence_id=999,
        parent=child,
        module=module,
    )

    update_work_item(module.id, parent_id=None)

    child.refresh_from_db()
    grandchild.refresh_from_db()
    assert child.module_id == module.id
    assert grandchild.module_id == module.id


@pytest.mark.django_db
def test_reparent_work_item_reroots_descendants_at_nested_module(project):
    module_a = _issue(
        id=uuid.uuid4(), project=project, type="module", name="A", sequence_id=995
    )
    module_d = _issue(
        id=uuid.uuid4(), project=project, type="module", name="D", sequence_id=996
    )
    task = _issue(
        id=uuid.uuid4(),
        project=project,
        name="T",
        sequence_id=997,
        parent=module_a,
        module=module_a,
    )
    nested_module = _issue(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="B",
        sequence_id=998,
        parent=task,
    )
    child = _issue(
        id=uuid.uuid4(),
        project=project,
        name="C",
        sequence_id=999,
        parent=nested_module,
        module=nested_module,
    )

    update_work_item(task.id, parent_id=module_d.id)

    task.refresh_from_db()
    child.refresh_from_db()
    assert task.module_id == module_d.id
    assert child.module_id == nested_module.id


@pytest.mark.django_db
def test_reorder_work_item_allocates_rank_between_neighbors(project):
    issue_a = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="A",
        sequence_id=1,
        rank="a",
    )
    issue_b = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="B",
        sequence_id=2,
        rank="c",
    )
    moving = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="M",
        sequence_id=3,
        rank="z",
    )

    updated = reorder_work_item(moving.id, before_id=issue_a.id, after_id=issue_b.id)

    assert issue_a.rank < updated.rank < issue_b.rank
    updated.refresh_from_db()
    assert updated.rank != "z"


@pytest.mark.django_db
def test_reorder_work_item_rejects_foreign_neighbor(project):
    other_project = Project.objects.create(
        id=uuid.uuid4(),
        name="Other",
    )
    moving = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="M",
        sequence_id=1,
        rank="b",
    )
    foreign = _issue(
        id=uuid.uuid4(),
        project=other_project,
        type="task",
        name="F",
        sequence_id=1,
        rank="c",
    )

    with pytest.raises(ValidationError) as excinfo:
        reorder_work_item(moving.id, before_id=foreign.id)

    assert excinfo.value.status_code == 422


@pytest.mark.django_db
def test_delete_work_item_rejects_children(project):
    parent = _issue(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="Parent",
        sequence_id=1,
    )
    _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Child",
        sequence_id=2,
        parent=parent,
        rank="a",
    )

    with pytest.raises(ServiceError) as excinfo:
        delete_work_item(parent.id)

    assert excinfo.value.status_code == 409


@pytest.mark.django_db
def test_delete_work_item_deletes_empty_issue(project):
    issue = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="A",
        sequence_id=1,
        rank="a",
    )

    delete_work_item(issue.id)

    assert not Issue.objects.filter(pk=issue.id).exists()


@pytest.mark.django_db
def test_update_work_item_archives_on_cancelled_and_cascades_descendants(project):
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    cancelled = State.objects.create(
        id=uuid.uuid4(), project=project, name="Cancelled", group="cancelled"
    )
    workflow_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Archivable",
        level="task",
        start_state=backlog,
    )
    IssueTypeTransition.objects.create(
        issue_type=workflow_type, from_state=backlog, to_state=cancelled
    )
    parent = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Parent",
        sequence_id=1,
        state=backlog,
        issue_type=workflow_type,
    )
    child = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Child",
        sequence_id=2,
        parent=parent,
        state=backlog,
        issue_type=workflow_type,
    )

    issue = update_work_item(parent.id, state_id=cancelled.id)

    parent.refresh_from_db()
    child.refresh_from_db()
    assert issue.is_archived is True
    assert parent.is_archived is True
    assert child.is_archived is True


@pytest.mark.django_db
def test_update_work_item_unarchives_only_moved_issue(project):
    cancelled = State.objects.create(
        id=uuid.uuid4(), project=project, name="Cancelled", group="cancelled"
    )
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    workflow_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Restorable",
        level="task",
        start_state=cancelled,
    )
    IssueTypeTransition.objects.create(
        issue_type=workflow_type, from_state=cancelled, to_state=backlog
    )
    parent = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Parent",
        sequence_id=1,
        state=cancelled,
        is_archived=True,
        issue_type=workflow_type,
    )
    child = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Child",
        sequence_id=2,
        parent=parent,
        state=cancelled,
        is_archived=True,
        issue_type=workflow_type,
    )

    update_work_item(parent.id, state_id=backlog.id)

    parent.refresh_from_db()
    child.refresh_from_db()
    assert parent.is_archived is False
    assert child.is_archived is True


@pytest.mark.django_db
def test_update_work_item_rejects_self_block_and_cycles(project):
    a = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="A",
        sequence_id=1,
    )
    b = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="B",
        sequence_id=2,
    )
    c = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="C",
        sequence_id=3,
    )

    with pytest.raises(ValidationError):
        update_work_item(a.id, blocked_by_ids=[a.id])

    update_work_item(a.id, blocked_by_ids=[b.id])
    update_work_item(b.id, blocked_by_ids=[c.id])
    with pytest.raises(ValidationError):
        update_work_item(c.id, blocked_by_ids=[a.id])


@pytest.mark.django_db
def test_update_work_item_omitted_blockers_do_not_clear(project):
    blocker = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Blocker",
        sequence_id=1,
    )
    issue = _issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Task",
        sequence_id=2,
    )
    issue.blocked_by.add(blocker)

    update_work_item(issue.id, name="Renamed")

    issue.refresh_from_db()
    assert list(issue.blocked_by.values_list("id", flat=True)) == [blocker.id]
