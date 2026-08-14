"""CODING-153: the first model-declared DRF resource, end to end."""

import jsonschema
import pytest
from django.urls import resolve

from worktracker.rest.exceptions import service_exception_handler
from worktracker.rest.views import WorkspaceRetrieveView
from worktracker.tests.conftest import BASE, TOKEN, openapi_path
from worktracker.workflow import InvalidTransition


@pytest.mark.django_db
def test_workspace_retrieve_is_owned_by_drf_and_requires_the_api_key(client, project):
    match = resolve(f"{BASE}/workspace")
    assert match.func.cls is WorkspaceRetrieveView

    assert client.get(f"{BASE}/workspace").status_code == 401
    assert (
        client.get(f"{BASE}/workspace", headers={"x-api-key": "wrong"}).status_code
        == 401
    )

    response = client.get(
        f"{BASE}/workspace", headers={"x-api-key": TOKEN}
    )
    assert response.status_code == 200
    assert response.json()["id"] == str(project.workspace_id)


@pytest.mark.django_db
def test_workspace_retrieve_keeps_the_disable_auth_escape(client, project, settings):
    settings.WORKTRACKER_DISABLE_AUTH = True

    response = client.get(f"{BASE}/workspace")

    assert response.status_code == 200
    assert response.json()["slug"] == project.workspace.slug


@pytest.mark.django_db
def test_workspace_response_validates_against_the_generated_drf_schema(
    client, project, auth
):
    schema_response = client.get(
        f"{BASE}/schema", headers={**auth, "accept": "application/json"}
    )
    assert schema_response.status_code == 200
    schema = schema_response.json()
    operation = schema["paths"][openapi_path(schema, f"{BASE}/workspace")]["get"]
    response_schema = operation["responses"]["200"]["content"][
        "application/json"
    ]["schema"]

    workspace_response = client.get(f"{BASE}/workspace", headers=auth)
    component_name = response_schema["$ref"].rsplit("/", maxsplit=1)[-1]
    jsonschema.validate(
        workspace_response.json(), schema["components"]["schemas"][component_name]
    )
    assert operation["security"] == [{"ApiKeyAuth": []}]


@pytest.mark.django_db
def test_workspace_service_error_uses_the_global_drf_handler(client, auth):
    response = client.get(f"{BASE}/workspace", headers=auth)

    assert response.status_code == 404
    assert response.json() == {"detail": "Workspace not found."}


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
