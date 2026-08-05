"""Contract checks for Ticketry's sole drf-spectacular HTTP document."""

import json
import os
from pathlib import Path
import subprocess
import sys

from worktracker.registry import declared_public_route_keys, declared_route_keys


ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
CONTRACT = ROOT / "openapi.json"


def _schema():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def _operations(schema):
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                yield path, method, operation


def _export(destination):
    environment = os.environ.copy()
    environment["DJANGO_SETTINGS_MODULE"] = "worktracker.openapi_settings"
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "django",
            "spectacular",
            "--file",
            str(destination),
            "--format",
            "openapi-json",
        ],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
    )


def test_drf_spectacular_export_is_byte_deterministic(tmp_path):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    first_run = _export(first)
    second_run = _export(second)

    assert first_run.returncode == 0, first_run.stderr
    assert second_run.returncode == 0, second_run.stderr
    assert first.read_bytes() == second.read_bytes() == CONTRACT.read_bytes()


def test_contract_is_the_complete_declared_ticketry_surface():
    schema = _schema()
    live = {(method.upper(), f"/api{path}") for path, method, _ in _operations(schema)}

    assert live == declared_route_keys()
    assert "/work-tracker/schema" not in schema["paths"]
    assert schema["servers"] == [{"url": "/api"}]


def test_operations_have_unique_ids_and_explicit_security():
    operations = list(_operations(_schema()))
    operation_ids = [operation["operationId"] for _, _, operation in operations]
    security_by_key = {
        (method.upper(), f"/api{path}"): operation["security"]
        for path, method, operation in operations
    }

    assert len(operation_ids) == len(set(operation_ids))
    assert all("security" in operation for _, _, operation in operations)
    assert {
        key for key, security in security_by_key.items() if security == [{}]
    } == declared_public_route_keys()
    assert all(
        security == ([{}] if key in declared_public_route_keys() else [{"ApiKeyAuth": []}])
        for key, security in security_by_key.items()
    )
    assert _schema()["components"]["securitySchemes"]["ApiKeyAuth"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
    }


def test_contract_records_flat_relations_and_binary_attachment_upload():
    schema = _schema()
    work_item = schema["components"]["schemas"]["WorkItem"]["properties"]
    upload = schema["paths"]["/work-tracker/work-items/{issue_id}/attachments"]["post"]
    multipart = upload["requestBody"]["content"]["multipart/form-data"]["schema"]

    assert work_item["state"] == {
        "type": "string",
        "format": "uuid",
        "nullable": True,
        "readOnly": True,
    }
    assert work_item["issue_type"]["format"] == "uuid"
    assert multipart["required"] == ["file"]
    assert multipart["properties"]["file"] == {
        "type": "string",
        "format": "binary",
    }


def test_module_archived_filter_and_issue_type_reassignment_body_are_declared():
    schema = _schema()
    module_list = schema["paths"]["/work-tracker/projects/{project_id}/modules"][
        "get"
    ]
    issue_type_delete = schema["paths"]["/work-tracker/issue-types/{type_id}"][
        "delete"
    ]

    assert any(
        parameter["name"] == "include_archived"
        and parameter["in"] == "query"
        for parameter in module_list["parameters"]
    )
    assert "requestBody" in issue_type_delete
    assert not any(
        parameter["name"] == "reassign_to"
        for parameter in issue_type_delete.get("parameters", [])
    )


def test_deleted_composite_routes_are_absent():
    paths = _schema()["paths"]

    assert "/work-tracker/work-items/{issue_id}/scope-context" not in paths
    assert "/work-tracker/issue-types/{type_id}/workflow-settings" not in paths
    assert "/work-tracker/projects/{project_id}/review-findings" not in paths
