"""Contract checks for the sole drf-spectacular WorkTracker document."""

import json
import os
from pathlib import Path
import subprocess
import sys

from worktracker.registry import declared_model_route_keys


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


def test_contract_is_the_declared_worktracker_surface_only():
    schema = _schema()
    live = {(method.upper(), f"/api/work-tracker{path}") for path, method, _ in _operations(schema)}
    declared = {
        key
        for key in declared_model_route_keys()
        if key[1].startswith("/api/work-tracker/")
    }

    assert live == declared
    assert "/schema" not in schema["paths"]
    assert schema["servers"] == [{"url": "/api/work-tracker"}]


def test_operations_have_unique_ids_and_uniform_api_key_security():
    operations = list(_operations(_schema()))
    operation_ids = [operation["operationId"] for _, _, operation in operations]

    assert len(operation_ids) == len(set(operation_ids))
    assert all(
        operation["security"] == [{"ApiKeyAuth": []}]
        for _, _, operation in operations
    )
    assert _schema()["components"]["securitySchemes"]["ApiKeyAuth"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
    }


def test_contract_records_flat_relations_and_binary_attachment_upload():
    schema = _schema()
    work_item = schema["components"]["schemas"]["WorkItem"]["properties"]
    upload = schema["paths"]["/work-items/{issue_id}/attachments"]["post"]
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


def test_deleted_composite_and_overlapping_routes_are_absent():
    paths = _schema()["paths"]

    assert "/modules/{module_id}/work-items" not in paths
    assert "/work-items/{issue_id}/scope-context" not in paths
    assert "/issue-types/{type_id}/workflow-settings" not in paths
    assert "/projects/{project_id}/review-findings" not in paths
