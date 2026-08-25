"""Workspace tab order persistence through the generated DRF contract."""

import json
import uuid

import pytest

from worktracker.models import Issue
from worktracker.tests.conftest import BASE, openapi_path, post_json


pytestmark = pytest.mark.django_db


@pytest.fixture
def work_item(client, project, task_type, auth):
    response = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "Ordered workspace", "issue_type_id": str(task_type.id)},
        auth,
    )
    assert response.status_code == 201
    return response.json()


def _url(issue_id):
    return f"{BASE}/work-items/{issue_id}/workspace-tab-order"


def _put(client, issue_id, order, auth):
    return client.put(
        _url(issue_id),
        data=json.dumps({"order": order}),
        content_type="application/json",
        headers=auth,
    )


def test_reads_empty_order_then_persists_interleaved_identites(
    client, work_item, auth
):
    assert client.get(_url(work_item["id"]), headers=auth).json() == {"order": []}
    order = [
        {"kind": "terminal", "id": "terminal-2"},
        {"kind": "details"},
        {"kind": "changes"},
        {"kind": "doc", "id": "design-doc"},
        {"kind": "terminal", "id": "terminal-1"},
    ]

    response = _put(client, work_item["id"], order, auth)

    assert response.status_code == 200
    assert response.json() == {"order": order}
    assert Issue.objects.get(pk=work_item["id"]).workspace_tab_order == order


def test_next_write_prunes_stale_identites(client, work_item, auth):
    stale = {"kind": "doc", "id": "deleted-doc"}
    retained_hidden = {"kind": "terminal", "id": "dismissed-terminal"}
    initial = [{"kind": "details"}, stale, retained_hidden]
    assert _put(client, work_item["id"], initial, auth).status_code == 200

    pruned = [{"kind": "details"}, retained_hidden]
    response = _put(client, work_item["id"], pruned, auth)

    assert response.status_code == 200
    assert response.json() == {"order": pruned}


@pytest.mark.parametrize("method", ["get", "put"])
def test_unknown_work_item_returns_not_found(client, auth, method):
    issue_id = uuid.uuid4()
    response = (
        client.get(_url(issue_id), headers=auth)
        if method == "get"
        else _put(client, issue_id, [], auth)
    )

    assert response.status_code == 404


@pytest.mark.parametrize(
    "order",
    [
        [{"kind": "doc"}],
        [{"kind": "details", "id": "not-allowed"}],
        [{"kind": "changes", "id": "not-allowed"}],
        [{"kind": "details"}, {"kind": "details"}],
        [{"kind": "changes"}, {"kind": "changes"}],
        [{"kind": "unknown", "id": "x"}],
    ],
)
def test_write_rejects_invalid_or_duplicate_identities(client, work_item, auth, order):
    assert _put(client, work_item["id"], order, auth).status_code == 400


def test_schema_publishes_named_read_and_write_contract(client, auth):
    schema = client.get(
        f"{BASE}/schema", headers={**auth, "accept": "application/json"}
    ).json()
    path = openapi_path(
        schema,
        f"{BASE}/work-items/{{issue_id}}/workspace-tab-order",
    )

    assert schema["paths"][path]["get"]["operationId"] == "getWorkspaceTabOrder"
    assert schema["paths"][path]["put"]["operationId"] == "updateWorkspaceTabOrder"
    assert "WorkspaceTabOrder" in schema["components"]["schemas"]
