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
        SourceControlApi,
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
            SourceControlApi,
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


def test_generated_worktrees_api_reads_module_worktrees() -> None:
    from worktracker_sdk.generated import (
        ActiveWorktree,
        ApiClient,
        Configuration,
        WorktreesApi,
    )

    project_id = UUID("11111111-1111-4111-8111-111111111111")
    module_id = UUID("22222222-2222-4222-8222-222222222222")
    requests = []
    configuration = Configuration(host="https://worktracker.test/api")
    client = ApiClient(configuration)
    worktree_json = (
        b'{"id":"worktree-task-589","task_id":"task-589",'
        b'"project_id":"11111111-1111-4111-8111-111111111111",'
        b'"module_id":"22222222-2222-4222-8222-222222222222",'
        b'"ticket_seq":589,"path":"/worktrees/task-589",'
        b'"branch":"wt/CODING-589","base_branch":"main",'
        b'"status":"active","created_at":"2026-08-24T09:00:00+00:00"}'
    )

    def request(method, url, *args, **kwargs):
        requests.append((method, url))
        return _StubHttpResponse(200, b"[" + worktree_json + b"]", "OK")

    client.rest_client.pool_manager.request = request

    worktrees = WorktreesApi(client).list_module_worktrees(
        module_id=module_id,
        project_id=project_id,
    )

    assert worktrees == [ActiveWorktree.model_validate_json(worktree_json)]
    assert worktrees[0].ticket_seq == 589
    assert worktrees[0].branch == "wt/CODING-589"
    assert requests == [
        (
            "GET",
            (
                "https://worktracker.test/api/work-tracker/projects/"
                f"{project_id}/modules/{module_id}/worktrees"
            ),
        )
    ]


def test_generated_source_control_api_reads_scoped_ship_records() -> None:
    from worktracker_sdk import ApiClient, Configuration, SourceControlApi

    project_id = UUID("11111111-1111-4111-8111-111111111111")
    module_id = UUID("22222222-2222-4222-8222-222222222222")
    task_id = UUID("55555555-5555-4555-8555-555555555555")
    requests = []
    configuration = Configuration(host="https://worktracker.test/api")
    client = ApiClient(configuration)

    record_json = (
        b'{"id":"33333333-3333-4333-8333-333333333333",'
        b'"action_id":"44444444-4444-4444-8444-444444444444",'
        b'"module_id":"22222222-2222-4222-8222-222222222222",'
        b'"task_id":null,"checkout_kind":"base",'
        b'"checkout_name":"Base checkout","branch":"main",'
        b'"commit_shas":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],'
        b'"commit_outcome":{"status":"done"},'
        b'"push_outcome":{"status":"failed","message":"Push was rejected."},'
        b'"create_pr_outcome":{"status":"skipped"},'
        b'"pr_url":null,"pr_number":null,"pr_state":null,'
        b'"action_at":"2026-08-24T10:00:00Z","pr_refreshed_at":null}'
    )

    def request(method, url, *args, **kwargs):
        requests.append((method, url))
        return _StubHttpResponse(
            200,
            record_json if method == "POST" else b"[" + record_json + b"]",
            "OK",
        )

    client.rest_client.pool_manager.request = request

    records = SourceControlApi(client).list_module_ship_records(
        module_id=module_id,
        project_id=project_id,
    )
    task_records = SourceControlApi(client).list_task_ship_records(
        project_id=project_id,
        task_id=task_id,
    )
    refreshed = SourceControlApi(client).refresh_ship_record_pull_request_state(
        module_id=module_id,
        project_id=project_id,
        record_id=UUID("33333333-3333-4333-8333-333333333333"),
    )

    assert records[0].branch == "main"
    assert records[0].commit_shas == ["a" * 40]
    assert task_records[0].branch == "main"
    assert refreshed.id == UUID("33333333-3333-4333-8333-333333333333")
    assert requests == [
        (
            "GET",
            (
                "https://worktracker.test/api/work-tracker/projects/"
                f"{project_id}/modules/{module_id}/ship-records"
            ),
        ),
        (
            "GET",
            (
                "https://worktracker.test/api/work-tracker/projects/"
                f"{project_id}/work-items/{task_id}/ship-records"
            ),
        ),
        (
            "POST",
            (
                "https://worktracker.test/api/work-tracker/projects/"
                f"{project_id}/modules/{module_id}/ship-records/"
                "33333333-3333-4333-8333-333333333333/refresh-pr-state"
            ),
        ),
    ]
