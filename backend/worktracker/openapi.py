"""Deterministic OpenAPI construction for the WorkTracker transport contract."""

from copy import deepcopy
from functools import lru_cache

from ninja import NinjaAPI

from worktracker.api import router


API_TITLE = "WorkTracker API"
API_VERSION = "0.1.0"
API_ROOT = "/api/work-tracker"

_HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
_CONFLICT_OPERATIONS = {
    "addIssueTypeWorkflowTransition",
    "clearIssueTypeWorkflowLaunchBinding",
    "createIssueType",
    "createProject",
    "deleteIssueType",
    "deleteState",
    "deleteWorkItem",
    "removeIssueTypeWorkflowTransition",
    "setIssueTypeWorkflowAutoStart",
    "setIssueTypeWorkflowStartState",
    "setIssueTypeWorkflowTransitionPermission",
    "updateIssueType",
    "upsertIssueTypeWorkflowLaunchBinding",
}


def _error_response(description, schema_name):
    return {
        "description": description,
        "content": {
            "application/json": {
                "schema": {"$ref": f"#/components/schemas/{schema_name}"}
            }
        },
    }


def _normalize_schema(schema):
    schema["servers"] = [{"url": API_ROOT}]
    components = schema.setdefault("components", {})
    components.setdefault("schemas", {}).update(
        {
            "MessageError": {
                "type": "object",
                "required": ["detail"],
                "properties": {"detail": {"type": "string"}},
            },
            "ValidationErrorDetail": {
                "type": "object",
                "required": ["type", "loc", "msg"],
                "properties": {
                    "type": {"type": "string"},
                    "loc": {
                        "type": "array",
                        "items": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
                    },
                    "msg": {"type": "string"},
                    "ctx": {"type": ["object", "null"], "additionalProperties": True},
                },
            },
            "ValidationError": {
                "type": "object",
                "required": ["detail"],
                "properties": {
                    "detail": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/ValidationErrorDetail"
                        },
                    }
                },
            },
        }
    )

    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method not in _HTTP_METHODS:
                continue
            responses = {
                str(status): response
                for status, response in operation.setdefault("responses", {}).items()
            }
            operation["responses"] = responses
            responses.setdefault(
                "401", _error_response("Invalid or missing API key", "MessageError")
            )
            if "{" in path:
                responses.setdefault(
                    "404", _error_response("Resource not found", "MessageError")
                )
            if method in {"post", "patch", "put", "delete"}:
                responses.setdefault(
                    "422",
                    _error_response("Request validation failed", "ValidationError"),
                )
            if operation["operationId"] in _CONFLICT_OPERATIONS:
                responses.setdefault(
                    "409", _error_response("Request conflicts with state", "MessageError")
                )

    return schema


@lru_cache(maxsize=1)
def _cached_schema():
    api = NinjaAPI(
        title=API_TITLE,
        version=API_VERSION,
        description="Canonical HTTP contract for WorkTracker clients.",
        urls_namespace="worktracker-openapi-export",
    )
    api.add_router("", router)
    return _normalize_schema(api.get_openapi_schema(path_prefix=""))


def build_openapi_schema():
    """Return an isolated copy of the normalized deterministic contract."""

    return deepcopy(_cached_schema())
