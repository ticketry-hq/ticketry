"""Module tab visibility through the generated DRF contract."""

# Ruff cannot distinguish imported pytest fixtures from ordinary redefinitions.
# ruff: noqa: F811

import json
import uuid

import pytest

from worktracker.models import Issue, ModulePresentation
from worktracker.tests.conftest import BASE, openapi_path
from worktracker.tests.module_reorder_fixtures import modules  # noqa: F401

pytestmark = pytest.mark.django_db


def _put(client, auth, module_id, tab_hidden):
    return client.put(
        f"{BASE}/module-presentations/{module_id}",
        data=json.dumps({"tab_hidden": tab_hidden}),
        content_type="application/json",
        headers=auth,
    )


def test_missing_presentation_is_visible_until_hidden(client, auth, project, modules):
    assert client.get(f"{BASE}/module-presentations", headers=auth).json() == []

    response = _put(client, auth, modules["b"].id, True)

    assert response.status_code == 200
    assert response.json() == {
        "module_id": str(modules["b"].id),
        "rank": "",
        "tab_hidden": True,
    }
    assert Issue.objects.filter(pk=modules["b"].id, name="b").exists()
    assert set(
        modules["b"].project.issues.filter(type="module").values_list(
            "name", flat=True
        )
    ) == {"a", "b", "c"}


def test_visibility_round_trip_preserves_canonical_rank(client, auth, modules):
    presentation = ModulePresentation.objects.create(
        module=modules["b"], rank="middle", tab_hidden=True
    )

    response = _put(client, auth, modules["b"].id, False)

    assert response.status_code == 200
    presentation.refresh_from_db()
    assert (presentation.rank, presentation.tab_hidden) == ("middle", False)
    assert response.json() == {
        "module_id": str(modules["b"].id),
        "rank": "middle",
        "tab_hidden": False,
    }


def test_deleted_and_unknown_modules_leave_no_stale_visibility_record(
    client, auth, modules
):
    assert _put(client, auth, modules["a"].id, True).status_code == 200
    modules["a"].delete()

    listed = client.get(f"{BASE}/module-presentations", headers=auth).json()

    assert listed == []
    assert _put(client, auth, uuid.uuid4(), True).status_code == 404


def test_schema_publishes_visibility_read_and_write(client, auth):
    schema = client.get(
        f"{BASE}/schema", headers={**auth, "accept": "application/json"}
    ).json()
    collection = openapi_path(schema, f"{BASE}/module-presentations")
    detail = openapi_path(schema, f"{BASE}/module-presentations/{{module_id}}")

    assert schema["paths"][collection]["get"]["operationId"] == (
        "listModulePresentations"
    )
    assert schema["paths"][detail]["put"]["operationId"] == (
        "updateModulePresentation"
    )
    write_ref = schema["paths"][detail]["put"]["requestBody"]["content"][
        "application/json"
    ]["schema"]["$ref"]
    write_schema = schema["components"]["schemas"][write_ref.rsplit("/", 1)[1]]
    assert write_schema["properties"] == {"tab_hidden": {"type": "boolean"}}
    assert write_schema["required"] == ["tab_hidden"]
