"""The write side of the Canonical module order (#360).

The first drag in an automatic project has to do three things at once: freeze
the exact order the user could see, apply their move, and make the project
manual. These tests call the public reorder service and HTTP operation and then
re-read the durable records through the canonical module collection, because
that collection is what every surface actually shows.
"""

import uuid

import pytest

from worktracker.models import Issue, IssueType, Project
from worktracker.services.errors import ValidationError
from worktracker.services.queries import list_modules
from worktracker.services.work_items import reorder_work_item
from worktracker.tests.conftest import BASE, post_json


def make_module(project, module_type, name, *, rank="", is_archived=False):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=module_type,
        type="module",
        name=name,
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        rank=rank,
        is_archived=is_archived,
    )


def module_names(project):
    """The project's modules exactly as every read surface would show them."""

    return [module["name"] for module in list_modules(str(project.id))]


def ranks_by_name(project):
    return {
        module.name: module.rank
        for module in Issue.objects.filter(project=project, type="module")
    }


@pytest.fixture
def modules(project, module_type):
    """Three automatic-mode modules, visible newest-created-first: c, b, a."""

    return {
        name: make_module(project, module_type, name) for name in ("a", "b", "c")
    }


def baseline(modules, *names):
    return [str(modules[name].id) for name in names]


# --- first drag ------------------------------------------------------------


@pytest.mark.django_db
def test_first_drag_freezes_the_visible_order_and_applies_the_move(project, modules):
    # Visible order is c, b, a. Drag a to the very top.
    reorder_work_item(
        modules["a"].id,
        before_id=None,
        after_id=modules["c"].id,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )

    project.refresh_from_db()
    assert project.manual_module_order is True
    assert module_names(project) == ["a", "c", "b"]


@pytest.mark.django_db
def test_first_drag_moves_nothing_but_the_dragged_module(project, modules):
    reorder_work_item(
        modules["a"].id,
        before_id=modules["c"].id,
        after_id=modules["b"].id,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )

    # The baseline order is preserved for every module the user did not drag.
    assert module_names(project) == ["c", "a", "b"]


@pytest.mark.django_db
def test_first_drag_seeds_from_the_supplied_order_not_the_server_fallback(
    project, modules
):
    # The user saw an activity-sorted order that the server does not know.
    reorder_work_item(
        modules["c"].id,
        before_id=modules["a"].id,
        after_id=None,
        initial_order_ids=baseline(modules, "b", "a", "c"),
    )

    assert module_names(project) == ["b", "a", "c"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "names",
    [
        pytest.param(("c", "b"), id="incomplete"),
        pytest.param(("c", "b", "a", "a"), id="duplicated"),
    ],
)
def test_incomplete_or_duplicated_baselines_roll_everything_back(
    project, modules, names
):
    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, *names),
        )

    project.refresh_from_db()
    assert project.manual_module_order is False
    assert set(ranks_by_name(project).values()) == {""}


@pytest.mark.django_db
def test_a_foreign_project_module_in_the_baseline_rolls_back(project, modules):
    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="other", slug="OTHER"
    )
    foreign_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other, name="Module", level="module"
    )
    foreign = make_module(other, foreign_type, "foreign")

    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b") + [str(foreign.id)],
        )

    project.refresh_from_db()
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_a_task_work_item_in_the_baseline_rolls_back(
    project, module_type, modules, task_type
):
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        name="task",
        sequence_id=99,
    )

    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b", "a") + [str(task.id)],
        )

    project.refresh_from_db()
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_an_archived_only_baseline_rolls_back(project, module_type, modules):
    archived = make_module(project, module_type, "archived", is_archived=True)

    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=[str(archived.id)],
        )

    project.refresh_from_db()
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_a_missing_baseline_rolls_back(project, modules):
    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id, before_id=None, after_id=modules["c"].id
        )

    project.refresh_from_db()
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_inverted_neighbors_leave_the_project_automatic(project, modules):
    # before/after inverted against the supplied baseline order.
    with pytest.raises(ValidationError):
        reorder_work_item(
            modules["a"].id,
            before_id=modules["b"].id,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )

    project.refresh_from_db()
    assert project.manual_module_order is False
    assert set(ranks_by_name(project).values()) == {""}


# --- later drags -----------------------------------------------------------


def seed_manual(modules, *names):
    reorder_work_item(
        modules[names[-1]].id,
        before_id=modules[names[-2]].id,
        after_id=None,
        initial_order_ids=[str(modules[name].id) for name in names],
    )


@pytest.mark.django_db
def test_a_later_drag_writes_only_the_moved_module_rank(project, modules):
    seed_manual(modules, "c", "b", "a")
    before = ranks_by_name(project)

    reorder_work_item(
        modules["a"].id, before_id=None, after_id=modules["c"].id
    )

    after = ranks_by_name(project)
    assert after["b"] == before["b"] and after["c"] == before["c"]
    assert after["a"] != before["a"]
    assert module_names(project) == ["a", "c", "b"]


@pytest.mark.django_db
def test_repeated_drags_between_the_same_neighbors_never_rebalance(project, modules):
    seed_manual(modules, "c", "b", "a")
    fixed = ranks_by_name(project)

    for _ in range(40):
        reorder_work_item(
            modules["a"].id, before_id=modules["c"].id, after_id=modules["b"].id
        )
        moved = ranks_by_name(project)
        assert fixed["c"] < moved["a"] < fixed["b"]
        assert moved["b"] == fixed["b"] and moved["c"] == fixed["c"]


@pytest.mark.django_db
def test_a_later_drag_rejects_a_cross_project_neighbor(project, modules):
    seed_manual(modules, "c", "b", "a")
    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="other", slug="OTHER"
    )
    foreign_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other, name="Module", level="module"
    )
    foreign = make_module(other, foreign_type, "foreign")

    with pytest.raises(ValidationError):
        reorder_work_item(modules["a"].id, before_id=foreign.id, after_id=None)


@pytest.mark.django_db
def test_a_module_may_not_be_ranked_against_a_task(project, modules, task_type):
    seed_manual(modules, "c", "b", "a")
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        name="task",
        sequence_id=99,
        rank="V",
    )

    with pytest.raises(ValidationError):
        reorder_work_item(modules["a"].id, before_id=task.id, after_id=None)


@pytest.mark.django_db
def test_a_task_may_not_be_ranked_against_a_module(project, modules, task_type):
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        name="task",
        sequence_id=99,
        rank="V",
    )

    with pytest.raises(ValidationError):
        reorder_work_item(task.id, before_id=modules["a"].id, after_id=None)


@pytest.mark.django_db
def test_a_task_reorder_rejects_a_module_baseline(project, modules, task_type):
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        name="task",
        sequence_id=99,
        rank="V",
    )

    with pytest.raises(ValidationError):
        reorder_work_item(
            task.id,
            before_id=None,
            after_id=None,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )


# --- concurrency -----------------------------------------------------------


@pytest.mark.django_db
def test_a_request_arriving_after_manual_mode_ignores_its_stale_baseline(
    project, modules
):
    """Two first drags serialize on the project row.

    The winner seeds the order. The loser's baseline is stale the moment it
    acquires the lock, so it must move only its own module against the ranks
    the winner just wrote — never re-seed the whole project from what it saw.
    """

    # Winner: seeds c, b, a and drags a to the top.
    reorder_work_item(
        modules["a"].id,
        before_id=None,
        after_id=modules["c"].id,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )
    seeded = ranks_by_name(project)

    # Loser: same gesture era, a baseline that disagrees, dragging b to the top.
    reorder_work_item(
        modules["b"].id,
        before_id=None,
        after_id=modules["a"].id,
        initial_order_ids=baseline(modules, "a", "b", "c"),
    )

    settled = ranks_by_name(project)
    assert settled["a"] == seeded["a"] and settled["c"] == seeded["c"]
    assert module_names(project) == ["b", "a", "c"]


# --- HTTP contract ---------------------------------------------------------


def reorder_request(client, auth, module_id, body):
    return post_json(client, f"{BASE}/work-items/{module_id}/reorder", body, auth)


@pytest.mark.django_db
def test_the_reorder_route_accepts_the_first_drag_baseline(
    client, auth, project, modules
):
    response = reorder_request(
        client,
        auth,
        modules["a"].id,
        {
            "before_id": None,
            "after_id": str(modules["c"].id),
            "initial_order_ids": baseline(modules, "c", "b", "a"),
        },
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(modules["a"].id)

    # A fresh read of the collection returns the same order the drag produced.
    listed = client.get(
        f"{BASE}/projects/{project.id}/modules", headers=auth
    ).json()
    assert [module["name"] for module in listed] == ["a", "c", "b"]


@pytest.mark.django_db
def test_the_reorder_route_rejects_an_incomplete_baseline(client, auth, project, modules):
    response = reorder_request(
        client,
        auth,
        modules["a"].id,
        {
            "before_id": None,
            "after_id": str(modules["c"].id),
            "initial_order_ids": baseline(modules, "c", "b"),
        },
    )

    assert response.status_code == 422
    project.refresh_from_db()
    assert project.manual_module_order is False
