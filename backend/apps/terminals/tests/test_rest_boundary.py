"""DRF boundary coverage for terminal and viewer-lease operations."""

from __future__ import annotations

import json

import pytest
from django.test import override_settings

from apps.terminals import domain_ops


pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/terminals?task_id=task-1"),
        ("post", "/api/terminals"),
        ("delete", "/api/terminals?agent_run_id=run-1"),
        ("post", "/api/terminals/resume?agent_run_id=run-1"),
        ("get", "/api/terminals/resumable"),
        ("get", "/api/terminals/scratch?project_id=project-1"),
        ("get", "/api/terminals/shells?module_id=module-1"),
        ("post", "/api/terminals/shells"),
        ("post", "/api/terminals/viewers/lease"),
        ("post", "/api/terminals/viewers/lease/renew"),
        ("post", "/api/terminals/viewers/lease/release"),
        ("post", "/api/terminals/viewers/output"),
    ],
)
@override_settings(
    WORKTRACKER_DISABLE_AUTH=False,
    WORKTRACKER_API_TOKEN="terminal-secret",
)
def test_terminal_routes_use_default_api_key_authentication(client, method, path):
    response = client.generic(
        method.upper(),
        path,
        data=json.dumps({}),
        content_type="application/json",
    )

    assert response.status_code == 401


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_viewer_lease_action_uses_serializer_allowlist(client, monkeypatch):
    captured = []

    def acquire(**values):
        captured.append(values)
        return {
            **values,
            "expires_at": "2026-08-19T12:00:00+00:00",
            "replaced": None,
        }

    monkeypatch.setattr(domain_ops.terminals, "acquire_viewer_lease", acquire)

    response = client.post(
        "/api/terminals/viewers/lease",
        data=json.dumps(
            {
                "agent_run_id": "run-1",
                "viewer_id": "viewer-1",
                "transport": "desktop",
                "expires_at": "caller-must-not-control-this",
            }
        ),
        content_type="application/json",
    )

    assert response.status_code == 200
    assert captured == [
        {
            "agent_run_id": "run-1",
            "viewer_id": "viewer-1",
            "transport": "desktop",
        }
    ]
    assert response.json() == {
        "agent_run_id": "run-1",
        "viewer_id": "viewer-1",
        "transport": "desktop",
        "expires_at": "2026-08-19T12:00:00+00:00",
        "replaced": None,
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_viewer_lease_action_rejects_invalid_transport_before_service(
    client, monkeypatch
):
    monkeypatch.setattr(
        domain_ops.terminals,
        "acquire_viewer_lease",
        lambda **values: pytest.fail(f"invalid input reached service: {values}"),
    )

    response = client.post(
        "/api/terminals/viewers/lease",
        data=json.dumps(
            {
                "agent_run_id": "run-1",
                "viewer_id": "viewer-1",
                "transport": "unknown",
            }
        ),
        content_type="application/json",
    )

    assert response.status_code == 400
    assert "transport" in response.json()


@pytest.mark.parametrize(
    ("path", "error"),
    [
        ("/api/terminals", "task_id_required"),
        ("/api/terminals/scratch", "project_id_required"),
        ("/api/terminals/shells", "module_id_required"),
    ],
)
@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_terminal_query_serializers_preserve_required_identity_errors(
    client, path, error
):
    response = client.get(path)

    assert response.status_code == 400
    assert response.json() == {"detail": {"error": error}}


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_terminal_identity_query_serializer_applies_to_commands(client):
    resumed = client.post("/api/terminals/resume")
    terminated = client.delete("/api/terminals")

    assert resumed.status_code == 400
    assert resumed.json() == {"detail": {"error": "agent_run_id_required"}}
    assert terminated.status_code == 400
    assert terminated.json() == {"detail": {"error": "agent_run_id_required"}}
