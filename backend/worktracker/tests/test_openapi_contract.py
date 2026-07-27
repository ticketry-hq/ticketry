import json

from django.core.management import call_command

from worktracker.openapi import API_ROOT, build_openapi_schema


def _operations(schema):
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                yield path, method, operation


def test_export_is_byte_deterministic(tmp_path):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    call_command("export_openapi", first)
    call_command("export_openapi", second)

    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes().endswith(b"\n")
    assert json.loads(first.read_text()) == build_openapi_schema()


def test_operations_have_unique_explicit_ids_tags_security_and_errors():
    schema = build_openapi_schema()
    operations = list(_operations(schema))
    operation_ids = [operation["operationId"] for _, _, operation in operations]

    assert len(operation_ids) == len(set(operation_ids))
    assert all(not operation_id.startswith("worktracker_api_") for operation_id in operation_ids)
    assert all(operation["tags"] != ["worktracker"] for _, _, operation in operations)
    assert all(operation["security"] == [{"ApiKeyAuth": []}] for _, _, operation in operations)
    assert all("401" in operation["responses"] for _, _, operation in operations)
    assert schema["servers"] == [{"url": API_ROOT}]
    assert schema["components"]["securitySchemes"]["ApiKeyAuth"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
    }


def test_contract_models_multipart_and_empty_responses():
    schema = build_openapi_schema()
    upload = schema["paths"]["/work-items/{issue_id}/attachments"]["post"]
    delete = schema["paths"]["/work-items/{issue_id}"]["delete"]
    patch = schema["components"]["schemas"]["WorkItemPatch"]["properties"]

    multipart = upload["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert "file" in multipart["properties"]
    assert "file" in multipart["required"]
    assert multipart["properties"]["file"]["format"] == "binary"
    assert delete["responses"]["204"] == {"description": "No Content"}

    for field in ("parent_id", "state_id"):
        assert field not in schema["components"]["schemas"]["WorkItemPatch"].get(
            "required", []
        )
        assert {"type": "null"} in patch[field]["anyOf"]
    assert patch["origin"] == {
        "default": "human",
        "enum": ["human", "agent"],
        "title": "Origin",
        "type": "string",
    }


def test_retired_operations_are_absent():
    schema = build_openapi_schema()
    operations = {
        (path, method, operation["operationId"])
        for path, method, operation in _operations(schema)
    }

    retired_ids = {
        "updateModule",
        "deleteModule",
        "listAttachments",
        "updateAttachment",
        "deleteAttachment",
        "archiveWorkItem",
        "unarchiveWorkItem",
    }
    assert retired_ids.isdisjoint(operation_id for _, _, operation_id in operations)
    assert "/attachments/{attachment_id}" not in schema["paths"]
    assert set(schema["paths"]["/work-items/{issue_id}/attachments"]) == {"post"}


def test_sprint_contract_is_absent():
    schema = build_openapi_schema()

    assert all("sprint" not in path.lower() for path in schema["paths"])
    assert all("sprint" not in name.lower() for name in schema["components"]["schemas"])
    assert "sprint_id" not in schema["components"]["schemas"]["WorkItemOut"]["properties"]
    assert "sprint_id" not in schema["components"]["schemas"]["WorkItemPatch"]["properties"]


def test_work_item_priority_contract_is_absent():
    schema = build_openapi_schema()

    for name in ("ModuleWorkItemIn", "WorkItemIn", "WorkItemPatch", "WorkItemOut"):
        assert "priority" not in schema["components"]["schemas"][name]["properties"]
