"""The HTTP contract of the module reorder route (#360).

The service behaviour itself is covered by the first-drag, later-drag and
concurrency modules. What matters here is that the route carries the baseline
through, answers with the moved module, reports a refused baseline as 422, and
that a fresh collection read agrees with the drag.
"""

import pytest

from worktracker.models import ModulePresentation
from worktracker.tests.conftest import BASE
from worktracker.tests.module_reorder_fixtures import (  # noqa: F401 - pytest fixture
    modules,
)
from worktracker.tests.module_reorder_fixtures import baseline, reorder_request


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
    assert response.json()["module_id"] == str(modules["a"].id)

    # A fresh read of the collection returns the same order the drag produced.
    listed = client.get(f"{BASE}/projects/{project.id}/modules", headers=auth).json()
    assert [module["name"] for module in listed] == ["a", "c", "b"]

    presentations = client.get(f"{BASE}/module-presentations", headers=auth).json()
    assert {row["module_id"] for row in presentations} == {
        str(module.id) for module in modules.values()
    }
    assert all(row["rank"] and row["tab_hidden"] is False for row in presentations)


@pytest.mark.django_db
def test_the_reorder_route_rejects_an_incomplete_baseline(
    client, auth, project, modules
):
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
    assert not ModulePresentation.objects.filter(module__project=project).exists()
