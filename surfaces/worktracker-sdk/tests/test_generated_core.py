"""Smoke coverage for the generated expand-phase SDK surface."""

from uuid import UUID

import pytest


def test_hand_rolled_surface_is_not_public() -> None:
    import worktracker_sdk
    import worktracker_sdk.generated as generated

    legacy_exports = (
        "ApiError",
        "TaskManagerClient",
        "WorkItemCreate",
        "WorkItemUpdate",
    )

    assert all(not hasattr(worktracker_sdk, name) for name in legacy_exports)
    assert not hasattr(worktracker_sdk, "WorkspaceApi")
    assert not hasattr(generated, "Workspace")


def test_generated_client_and_tag_apis_are_public() -> None:
    from worktracker_sdk import (
        ApiClient,
        AttachmentsApi,
        IssueTypesApi,
        ModulesApi,
        ProjectsApi,
        StatesApi,
        WorkItemsApi,
    )

    assert all(
        isinstance(export, type)
        for export in (
            ApiClient,
            AttachmentsApi,
            IssueTypesApi,
            ModulesApi,
            ProjectsApi,
            StatesApi,
            WorkItemsApi,
        )
    )


def test_generated_model_round_trips() -> None:
    from worktracker_sdk.generated import Project

    project = Project(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        name="Memory Lane",
        slug="MEML",
        description="Generated model smoke test",
        manual_module_order=False,
        onboarding_required=False,
    )

    assert Project.model_validate_json(project.model_dump_json()) == project


class _StubHttpResponse:
    def __init__(self, status: int, body: bytes, reason: str) -> None:
        self.status = status
        self.data = body
        self.reason = reason
        self.headers = {"content-type": "application/json"}


def test_generated_api_uses_stubbed_http_layer() -> None:
    from worktracker_sdk import ApiClient, Configuration, ProjectsApi

    configuration = Configuration(host="https://worktracker.test/api")
    client = ApiClient(configuration)
    client.rest_client.pool_manager.request = lambda *args, **kwargs: _StubHttpResponse(
        200,
        b'[{"id":"11111111-1111-1111-1111-111111111111",'
        b'"name":"Memory Lane","slug":"MEML","description":"",'
        b'"manual_module_order":false,"onboarding_required":false}]',
        "OK",
    )

    projects = ProjectsApi(client).list_projects()

    assert [(project.slug, project.name) for project in projects] == [
        ("MEML", "Memory Lane")
    ]


def test_generated_api_maps_http_errors() -> None:
    from worktracker_sdk import ApiClient, Configuration, ProjectsApi
    from worktracker_sdk.generated.exceptions import NotFoundException

    configuration = Configuration(host="https://worktracker.test/api")
    client = ApiClient(configuration)
    client.rest_client.pool_manager.request = lambda *args, **kwargs: _StubHttpResponse(
        404,
        b'{"detail":"not found"}',
        "Not Found",
    )

    with pytest.raises(NotFoundException) as error:
        ProjectsApi(client).list_projects()

    assert error.value.status == 404
