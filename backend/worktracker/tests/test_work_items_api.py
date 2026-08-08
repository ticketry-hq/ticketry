"""CODING-156: canonical work-item CRUD and its declared contract."""

import copy
import uuid

import jsonschema
import pytest

from worktracker.models import Issue, IssueType, Project, State
from worktracker.registry import MODEL_ROUTES
from worktracker.tests.conftest import BASE, openapi_path, patch_json, post_json


pytestmark = pytest.mark.django_db


def _create(client, project, task_type, auth, **overrides):
    body = {"name": "Task", "issue_type_id": str(task_type.id), **overrides}
    response = post_json(client, f"{BASE}/projects/{project.id}/work-items", body, auth)
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def work_item(client, project, task_type, state, auth):
    return _create(client, project, task_type, auth, state_id=str(state.id))


@pytest.fixture
def module(client, project, module_type, auth):
    response = post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        {"name": "Epic", "issue_type_id": str(module_type.id)},
        auth,
    )
    assert response.status_code == 201
    return response.json()


def _response_schema(schema, path, method):
    operation = schema["paths"][openapi_path(schema, path)][method.lower()]
    return operation["responses"]["200"]["content"]["application/json"]["schema"]


def _as_json_schema(openapi_schema):
    """Translate OpenAPI 3's ``nullable`` keyword for jsonschema validation."""

    schema = copy.deepcopy(openapi_schema)

    def visit(value):
        if isinstance(value, dict):
            if value.pop("nullable", False) and "type" in value:
                value["type"] = [value["type"], "null"]
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)
    return schema


@pytest.mark.parametrize("declaration", MODEL_ROUTES["WorkItem"]["reads"])
def test_declared_work_item_reads_validate_against_the_generated_schema(
    declaration, client, project, work_item, auth
):
    schema = _as_json_schema(
        client.get(
            f"{BASE}/schema", headers={**auth, "accept": "application/json"}
        ).json()
    )
    if declaration.path.endswith("/batch"):
        url = declaration.path
    elif declaration.path.endswith("/{issue_id}"):
        url = declaration.path.format(issue_id=work_item["id"])
    else:
        url = f"{declaration.path}?project={project.id}"

    response = (
        post_json(client, url, {"ids": [work_item["id"]]}, auth)
        if declaration.method == "POST"
        else client.get(url, headers=auth)
    )

    assert response.status_code == 200
    jsonschema.validate(
        response.json(),
        _response_schema(schema, declaration.path, declaration.method),
        resolver=jsonschema.RefResolver.from_schema(schema),
    )


@pytest.mark.parametrize("declaration", MODEL_ROUTES["WorkItem"]["writes"])
def test_declared_work_item_writes_reject_invalid_input_and_persist_valid_input(
    declaration, client, project, task_type, work_item, auth
):
    if declaration.method == "POST":
        url = declaration.path.format(project_id=project.id)
        invalid = post_json(client, url, {}, auth)
        valid = post_json(
            client,
            url,
            {"name": "Created", "issue_type_id": str(task_type.id)},
            auth,
        )
        assert invalid.status_code == 400
        assert valid.status_code == 201
        assert Issue.objects.filter(pk=valid.json()["id"], name="Created").exists()
    elif declaration.method == "PATCH":
        url = declaration.path.format(issue_id=work_item["id"])
        invalid = patch_json(client, url, {"state_id": "not-a-uuid"}, auth)
        valid = patch_json(client, url, {"name": "Renamed"}, auth)
        assert invalid.status_code == 400
        assert valid.status_code == 200
        assert Issue.objects.get(pk=work_item["id"]).name == "Renamed"
    else:
        missing_url = declaration.path.format(issue_id=uuid.uuid4())
        invalid = client.delete(missing_url, headers=auth)
        url = declaration.path.format(issue_id=work_item["id"])
        valid = client.delete(url, headers=auth)
        assert invalid.status_code == 404
        assert valid.status_code == 204
        assert not Issue.objects.filter(pk=work_item["id"]).exists()


def test_patch_changes_a_task_issue_type_without_moving_its_state(
    client, project, task_type, work_item, auth
):
    replacement = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
    )

    response = patch_json(
        client,
        f"{BASE}/work-items/{work_item['id']}",
        {"issue_type_id": str(replacement.id)},
        auth,
    )

    assert response.status_code == 200
    assert response.json()["issue_type"] == str(replacement.id)
    changed = Issue.objects.get(pk=work_item["id"])
    assert changed.issue_type_id == replacement.id
    assert str(changed.state_id) == work_item["state"]


def test_one_list_route_narrows_by_project_module_and_state(
    client, project, module, task_type, auth
):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Selected", group="started"
    )
    other_state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Other", group="unstarted"
    )
    selected = _create(
        client,
        project,
        task_type,
        auth,
        name="Selected",
        parent_id=module["id"],
        state_id=str(state.id),
    )
    child = _create(
        client,
        project,
        task_type,
        auth,
        name="Nested",
        parent_id=selected["id"],
        state_id=str(state.id),
    )
    _create(
        client,
        project,
        task_type,
        auth,
        name="Wrong state",
        parent_id=module["id"],
        state_id=str(other_state.id),
    )
    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="Other", slug="OTHER"
    )
    other_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other, name="Task", level="task"
    )
    _create(client, other, other_type, auth, name="Wrong project")

    response = client.get(
        f"{BASE}/work-items?project={project.id}&module={module['id']}&state={state.id}",
        headers=auth,
    )

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {selected["id"], child["id"]}


def test_batch_read_returns_only_existing_requested_ids_in_request_order(
    client, project, task_type, auth
):
    first = _create(client, project, task_type, auth, name="First")
    second = _create(client, project, task_type, auth, name="Second")

    response = post_json(
        client,
        f"{BASE}/work-items/batch",
        {"ids": [second["id"], str(uuid.uuid4()), first["id"], second["id"]]},
        auth,
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [second["id"], first["id"]]


def test_batch_read_accepts_one_hundred_ids(client, project, task_type, auth):
    existing = _create(client, project, task_type, auth)
    ids = [existing["id"], *(str(uuid.uuid4()) for _ in range(99))]

    response = post_json(
        client,
        f"{BASE}/work-items/batch",
        {"ids": ids},
        auth,
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [existing["id"]]


@pytest.mark.parametrize(
    "ids",
    [[], ["not-a-uuid"], [str(uuid.uuid4()) for _ in range(101)]],
)
def test_batch_read_rejects_invalid_or_oversized_bodies(client, auth, ids):
    response = post_json(client, f"{BASE}/work-items/batch", {"ids": ids}, auth)

    assert response.status_code == 400


def test_default_list_hides_the_stable_pathfind_role_and_its_descendants(
    client, project, module, task_type, auth
):
    pathfind_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="PathFind",
        level="task",
        is_pathfind=True,
    )
    root = _create(
        client,
        project,
        pathfind_type,
        auth,
        name="Explore",
        parent_id=module["id"],
    )
    child = _create(
        client,
        project,
        task_type,
        auth,
        name="Nested implementation",
        parent_id=root["id"],
    )
    visible = _create(
        client,
        project,
        task_type,
        auth,
        name="Visible",
        parent_id=module["id"],
    )
    pathfind_type.name = "Discovery"
    pathfind_type.save(update_fields=("name", "updated_at"))

    default = client.get(
        f"{BASE}/work-items?project={project.id}&module={module['id']}",
        headers=auth,
    )
    included = client.get(
        f"{BASE}/work-items?project={project.id}&module={module['id']}"
        "&include_pathfind=true",
        headers=auth,
    )

    assert [row["id"] for row in default.json()] == [visible["id"]]
    assert {row["id"] for row in included.json()} == {
        root["id"],
        child["id"],
        visible["id"],
    }


def test_every_work_item_response_uses_bare_state_and_issue_type_ids(
    client, project, task_type, auth
):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    created = _create(client, project, task_type, auth, state_id=str(state.id))
    retrieved = client.get(f"{BASE}/work-items/{created['id']}", headers=auth).json()
    listed = client.get(f"{BASE}/work-items?project={project.id}", headers=auth).json()
    patched = patch_json(
        client, f"{BASE}/work-items/{created['id']}", {"name": "After"}, auth
    ).json()

    for row in (created, retrieved, listed[0], patched):
        assert row["state"] == str(state.id)
        assert row["issue_type"] == str(task_type.id)
        assert not isinstance(row["state"], dict)
        assert not isinstance(row["issue_type"], dict)
    assert "task" not in retrieved
    assert "attachments" not in retrieved


def test_state_move_keeps_the_pinned_structured_422_body(
    client, project, task_type, auth
):
    start = State.objects.create(
        id=uuid.uuid4(), project=project, name="Start", group="unstarted"
    )
    target = State.objects.create(
        id=uuid.uuid4(), project=project, name="Target", group="started"
    )
    task_type.start_state = start
    task_type.save(update_fields=("start_state",))
    item = _create(client, project, task_type, auth)

    response = patch_json(
        client,
        f"{BASE}/work-items/{item['id']}",
        {"state_id": str(target.id)},
        auth,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "'Target' is not a state in the published workflow.",
        "code": "unknown_state",
        "from": "Start",
        "to": "Target",
    }
