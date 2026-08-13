"""Run-scoped authorization contract consumed by the in-process Rust MCP."""

import pytest

from apps.runs.models import AgentRun
from apps.terminals.api import authorize_mcp_run
from apps.terminals.authorization import (
    RunAuthorizationError,
    issue_run_authorization,
    verify_run_authorization,
)
from worktracker.tests.factories import ensure_issue


pytestmark = pytest.mark.django_db(transaction=True)


def _run(run_id="run-mcp", *, project_id="project-mcp", task_id="task-mcp"):
    issue = ensure_issue(
        project_id=project_id,
        module_id="module-mcp",
        task_id=task_id,
    )
    return AgentRun.objects.create(
        id=run_id,
        issue=issue,
        agent="codex",
        status="running",
        started_at="2026-08-12T12:00:00Z",
        scope="task",
    )


def test_authorize_mcp_run_returns_only_the_signed_runs_worktracker_scope():
    run = _run()

    principal = authorize_mcp_run(issue_run_authorization(run.id))

    assert principal == {
        "agent_run_id": run.id,
        "issue_id": str(run.issue_id),
        "project_id": str(run.issue.project_id),
        "scope": "task",
    }


def test_mcp_authorization_endpoint_requires_sidecar_auth_and_returns_principal(
    client, settings
):
    run = _run("run-http")
    settings.WORKTRACKER_DISABLE_AUTH = False
    settings.WORKTRACKER_API_TOKEN = "fixture-key"

    unauthorized = client.post(
        "/api/terminals/mcp-authorize",
        HTTP_AUTHORIZATION=issue_run_authorization(run.id),
    )
    assert unauthorized.status_code == 401

    response = client.post(
        "/api/terminals/mcp-authorize",
        HTTP_X_API_KEY="fixture-key",
        HTTP_AUTHORIZATION=issue_run_authorization(run.id),
    )
    assert response.status_code == 200
    assert response.json()["agent_run_id"] == run.id
    assert response.json()["project_id"] == str(run.issue.project_id)


def test_timestamped_run_authorization_expires_without_changing_invalid_errors():
    authorization = issue_run_authorization("run-expired")

    with pytest.raises(RunAuthorizationError, match="authorization_expired"):
        verify_run_authorization(authorization, max_age=-1)

    with pytest.raises(RunAuthorizationError, match="authorization_invalid"):
        verify_run_authorization("Bearer invalid.signature")


def test_authorize_mcp_run_rejects_unknown_and_ended_runs():
    from apps.errors import ApplicationError

    unknown = issue_run_authorization("run-unknown")
    with pytest.raises(ApplicationError, match="caller_run_unknown"):
        authorize_mcp_run(unknown)

    run = _run("run-ended")
    run.ended_at = "2026-08-12T12:05:00Z"
    run.save(update_fields=["ended_at"])
    with pytest.raises(ApplicationError, match="caller_run_inactive"):
        authorize_mcp_run(issue_run_authorization(run.id))
