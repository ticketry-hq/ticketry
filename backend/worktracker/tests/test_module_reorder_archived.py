"""Archived modules stay out of the Manual module order write path (#370).

The Canonical module collection never shows an archived module, so neither end
of a drag may be one: not the module being moved, and not a neighbor it is
dropped against. Both rejections have to leave the project exactly as they
found it — still in whatever ordering mode it had, with every rank untouched —
because the dangerous case is the *first* drag, where letting an invisible
module through would seed the visible baseline into ranks and flip the project
to manual mode on behalf of a module nobody can see.
"""

import pytest

from worktracker.models import ModulePresentation
from worktracker.services.errors import ValidationError
from worktracker.services.module_reorder import reorder_module
from worktracker.tests.module_reorder_fixtures import (
    baseline,
    make_module,
    modules,  # noqa: F401 — the three-module fixture, reused verbatim.
    module_names,
    ranks_by_name,
    reorder_request,
)


@pytest.fixture
def archived(project, module_type):
    return make_module(project, module_type, "archived", is_archived=True)


def assert_untouched(project):
    """The project never left automatic mode and no rank was written."""

    assert not ModulePresentation.objects.filter(module__project=project).exists()


# --- the moved module ------------------------------------------------------


@pytest.mark.django_db
def test_dragging_an_archived_module_is_rejected_on_the_first_drag(
    project, modules, archived
):
    with pytest.raises(ValidationError):
        reorder_module(
            archived.id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )

    assert_untouched(project)


@pytest.mark.django_db
def test_dragging_an_archived_module_is_rejected_in_a_manual_project(
    project, modules, archived
):
    reorder_module(
        modules["a"].id,
        before_id=modules["b"].id,
        after_id=None,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )
    seeded = ranks_by_name(project)

    with pytest.raises(ValidationError):
        reorder_module(archived.id, before_id=None, after_id=modules["c"].id)

    assert ranks_by_name(project) == seeded
    assert module_names(project) == ["c", "b", "a"]


# --- the drop neighbors ----------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("side", ["before_id", "after_id"])
def test_an_archived_neighbor_is_rejected_on_the_first_drag(
    project, modules, archived, side
):
    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            initial_order_ids=baseline(modules, "c", "b", "a"),
            **{side: archived.id},
        )

    assert_untouched(project)


@pytest.mark.django_db
@pytest.mark.parametrize("side", ["before_id", "after_id"])
def test_an_archived_neighbor_is_rejected_in_a_manual_project(
    project, modules, archived, side
):
    reorder_module(
        modules["a"].id,
        before_id=modules["b"].id,
        after_id=None,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )
    seeded = ranks_by_name(project)
    ModulePresentation.objects.create(module=archived, rank="V")

    with pytest.raises(ValidationError):
        reorder_module(modules["a"].id, **{side: archived.id})

    assert ranks_by_name(project) == {**seeded, "archived": "V"}
    assert module_names(project) == ["c", "b", "a"]


# --- HTTP contract ---------------------------------------------------------


@pytest.mark.django_db
def test_the_reorder_route_rejects_an_archived_module(
    client, auth, project, modules, archived
):
    response = reorder_request(
        client,
        auth,
        archived.id,
        {
            "before_id": None,
            "after_id": str(modules["c"].id),
            "initial_order_ids": baseline(modules, "c", "b", "a"),
        },
    )

    assert response.status_code == 422
    assert_untouched(project)
    assert not ModulePresentation.objects.filter(module=archived).exists()


@pytest.mark.django_db
def test_the_reorder_route_rejects_an_archived_neighbor(
    client, auth, project, modules, archived
):
    response = reorder_request(
        client,
        auth,
        modules["a"].id,
        {
            "before_id": None,
            "after_id": str(archived.id),
            "initial_order_ids": baseline(modules, "c", "b", "a"),
        },
    )

    assert response.status_code == 422
    assert_untouched(project)
