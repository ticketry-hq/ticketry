"""Registry-parameterized DRF contract tests for CODING-158."""

import copy
import uuid

import jsonschema
import pytest

from worktracker.models import IssueType, State
from worktracker.registry import MODEL_ROUTES
from worktracker.tests.conftest import openapi_path, patch_json, post_json


pytestmark = pytest.mark.django_db


def _schema(client, auth):
    schema = client.get(
        "/api/work-tracker/schema",
        headers={**auth, "accept": "application/json"},
    ).json()
    schema = copy.deepcopy(schema)

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


@pytest.mark.parametrize("model_name", ("State", "IssueType"))
def test_declared_configuration_reads_validate_schema_and_explicit_order(
    model_name, client, project, auth
):
    if model_name == "State":
        later = State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Later",
            group="started",
            sort_order=9,
        )
        earlier = State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Earlier",
            group="started",
            sort_order=2,
        )
    else:
        later = IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Later",
            level="task",
            sort_order=9,
        )
        earlier = IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Earlier",
            level="task",
            sort_order=2,
        )

    declaration = MODEL_ROUTES[model_name]["reads"][0]
    response = client.get(declaration.path.format(project_id=project.id), headers=auth)

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(earlier.id), str(later.id)]
    schema = _schema(client, auth)
    response_schema = schema["paths"][openapi_path(schema, declaration.path)]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    jsonschema.validate(
        response.json(),
        response_schema,
        resolver=jsonschema.RefResolver.from_schema(schema),
    )


WRITE_DECLARATIONS = tuple(
    (model_name, declaration)
    for model_name in ("State", "IssueType")
    for declaration in MODEL_ROUTES[model_name]["writes"]
)


@pytest.mark.parametrize(("model_name", "declaration"), WRITE_DECLARATIONS)
def test_declared_configuration_writes_reject_invalid_and_persist_valid(
    model_name, declaration, client, project, auth
):
    model = State if model_name == "State" else IssueType
    if declaration.method == "POST":
        url = declaration.path.format(project_id=project.id)
        invalid = post_json(client, url, {"name": "Invalid"}, auth)
        valid_body = (
            {"name": "Review", "group": "started"}
            if model_name == "State"
            else {"name": "Bug", "level": "task"}
        )
        valid = post_json(client, url, valid_body, auth)

        assert invalid.status_code == 400
        assert valid.status_code == 201
        assert model.objects.filter(pk=valid.json()["id"]).exists()
    elif declaration.method == "PATCH":
        instance = (
            State.objects.create(
                id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
            )
            if model_name == "State"
            else IssueType.objects.create(
                id=uuid.uuid4(), project=project, name="Task", level="task"
            )
        )
        url = declaration.path.format(
            state_id=instance.id,
            type_id=instance.id,
        )
        invalid_body = (
            {"group": "invalid"} if model_name == "State" else {"level": "module"}
        )
        invalid = patch_json(client, url, invalid_body, auth)
        valid = patch_json(client, url, {"name": "Renamed"}, auth)

        assert invalid.status_code == 400
        assert valid.status_code == 200
        instance.refresh_from_db()
        assert instance.name == "Renamed"
    else:
        instance = (
            State.objects.create(
                id=uuid.uuid4(), project=project, name="Doing", group="started"
            )
            if model_name == "State"
            else IssueType.objects.create(
                id=uuid.uuid4(), project=project, name="Task", level="task"
            )
        )
        if model_name == "State":
            State.objects.create(
                id=uuid.uuid4(), project=project, name="Review", group="started"
            )
        missing_url = declaration.path.format(
            state_id=uuid.uuid4(),
            type_id=uuid.uuid4(),
        )
        url = declaration.path.format(state_id=instance.id, type_id=instance.id)

        assert client.delete(missing_url, headers=auth).status_code == 404
        assert client.delete(url, headers=auth).status_code == 204
        assert not model.objects.filter(pk=instance.id).exists()
