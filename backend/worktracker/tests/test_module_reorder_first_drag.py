"""The first drag in an automatic project (#360).

That one gesture has to do three things at once: freeze the exact order the
user could see, apply their move, and make the project manual. These tests call
the public reorder service and then re-read the durable records through the
canonical module collection, because that collection is what every surface
actually shows. Rejected baselines live in
``test_module_reorder_baseline_validation``.
"""

import pytest

from worktracker.services.work_items import reorder_work_item
from worktracker.tests.module_reorder_fixtures import (  # noqa: F401 - pytest fixture
    modules,
)
from worktracker.tests.module_reorder_fixtures import baseline, module_names


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
