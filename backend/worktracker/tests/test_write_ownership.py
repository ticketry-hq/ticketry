import json

from django.http import HttpResponse
from django.test import RequestFactory

from worktracker.write_ownership import (
    RUST_OWNER_ENV,
    RustWorkTrackerWriteOwnershipMiddleware,
)


def guarded_response(method: str, path: str):
    request = getattr(RequestFactory(), method.lower())(
        path,
        data={},
        content_type="application/json",
    )
    return RustWorkTrackerWriteOwnershipMiddleware(
        lambda _request: HttpResponse(status=204)
    )(request)


def test_rust_owner_disables_django_worktracker_mutations(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    response = guarded_response("POST", "/api/work-tracker/projects")

    assert response.status_code == 410
    assert json.loads(response.content)["code"] == "django_worktracker_write_disabled"


def test_rust_owner_keeps_reads_and_django_owned_execution_routes_available(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    assert guarded_response("GET", "/api/work-tracker/projects").status_code == 204
    assert (
        guarded_response(
            "POST", "/api/work-tracker/work-items/missing/graph-run"
        ).status_code
        == 204
    )
