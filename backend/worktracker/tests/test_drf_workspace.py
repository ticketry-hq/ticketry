"""Removed Workspace HTTP contract and retained global error handling."""

import pytest
from django.urls import Resolver404, resolve

from worktracker.rest.exceptions import service_exception_handler
from worktracker.tests.conftest import BASE
from worktracker.workflow import InvalidTransition


@pytest.mark.django_db
def test_workspace_route_is_removed(client, auth):
    with pytest.raises(Resolver404):
        resolve(f"{BASE}/workspace")
    assert client.get(f"{BASE}/workspace", headers=auth).status_code == 404


@pytest.mark.django_db
def test_workspace_is_absent_from_the_generated_drf_schema(client, auth):
    schema_response = client.get(
        f"{BASE}/schema", headers={**auth, "accept": "application/json"}
    )
    assert schema_response.status_code == 200
    schema = schema_response.json()
    assert all("workspace" not in path.lower() for path in schema["paths"])
    assert all("workspace" not in name.lower() for name in schema["components"]["schemas"])


def test_global_drf_handler_preserves_structured_service_error_bodies():
    error = InvalidTransition(
        "That move is not allowed.",
        code="illegal_transition",
        from_state="Todo",
        to_state="Done",
    )

    response = service_exception_handler(error, {})

    assert response.status_code == 422
    assert response.data == {
        "detail": "That move is not allowed.",
        "code": "illegal_transition",
        "from": "Todo",
        "to": "Done",
    }
