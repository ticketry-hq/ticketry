from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone
from worktracker.models import Issue, IssueType, Project

from apps.source_control.errors import ProviderTimedOut, ProviderUnavailable
from apps.source_control.gh_cli import GhCompletion
from apps.source_control.models import (
    CHECKOUT_WORKTREE,
    PR_CLOSED,
    PR_MERGED,
    PR_OPEN,
    STEP_DONE,
    ShipRecord,
)
from apps.source_control.ship_record_serializers import ShipRecordSerializer
from apps.source_control.tests.conftest import MODULE_ID, PROJECT_ID, TASK_ID

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


def _record(*, pr_url="https://github.com/ticketry-hq/ticketry/pull/42"):
    has_pr = pr_url is not None
    return ShipRecord.objects.create(
        action_id=uuid.uuid4(),
        module_id=MODULE_ID,
        task_id=TASK_ID,
        checkout_kind=CHECKOUT_WORKTREE,
        checkout_name="CODING-1047 checkout",
        branch="wt/CODING-1047",
        commit_shas=["a" * 40],
        commit_outcome={"status": STEP_DONE},
        push_outcome={"status": STEP_DONE},
        create_pr_outcome={"status": STEP_DONE},
        pr_url=pr_url,
        pr_number=42 if has_pr else None,
        pr_state=PR_OPEN if has_pr else None,
        action_at=timezone.now() - timedelta(hours=2),
        pr_refreshed_at=timezone.now() - timedelta(hours=1) if has_pr else None,
    )


def _url(record, *, project_id=PROJECT_ID, module_id=MODULE_ID):
    return (
        f"/api/work-tracker/projects/{project_id}/modules/{module_id}/"
        f"ship-records/{record.id}/refresh-pr-state"
    )


def _post(record, **scope):
    return Client().post(
        _url(record, **scope), data={}, content_type="application/json"
    )


@pytest.mark.parametrize(
    ("provider_state", "stored_state"),
    (("OPEN", PR_OPEN), ("MERGED", PR_MERGED), ("CLOSED", PR_CLOSED)),
)
def test_refresh_performs_one_lookup_and_normalizes_only_refresh_fields(
    monkeypatch, provider_state, stored_state
):
    record = _record()
    before = ShipRecordSerializer(record).data
    refreshed_at = timezone.now()
    calls = []

    def run_gh(args, **kwargs):
        calls.append((args, kwargs))
        return GhCompletion(0, f'{{"state":"{provider_state}"}}', "")

    monkeypatch.setattr("apps.source_control.pull_request_state.run_gh", run_gh)
    monkeypatch.setattr(
        "apps.source_control.ship_record_refresh.timezone.now",
        lambda: refreshed_at,
    )

    response = _post(record)

    assert response.status_code == 200
    assert len(calls) == 1
    assert calls[0][0] == [
        "pr",
        "view",
        "https://github.com/ticketry-hq/ticketry/pull/42",
        "--json",
        "state",
    ]
    assert calls[0][1]["operation"] == "the pull request state"

    record.refresh_from_db()
    after = ShipRecordSerializer(record).data
    assert record.pr_state == stored_state
    assert record.pr_refreshed_at == refreshed_at
    assert response.data == after
    for field in set(before) - {"pr_state", "pr_refreshed_at"}:
        assert after[field] == before[field]


@pytest.mark.parametrize(
    ("failure", "expected_status", "expected_code"),
    (
        ("unavailable", 503, "provider_unavailable"),
        ("authentication", 409, "provider_not_authenticated"),
        ("missing", 404, "pull_request_not_found"),
        ("timeout", 504, "provider_timeout"),
        ("malformed", 502, "provider_response_malformed"),
        ("refused", 502, "provider_lookup_failed"),
        ("unsupported", 422, "pull_request_url_unsupported"),
    ),
)
def test_refresh_failures_are_typed_sanitized_and_preserve_stored_facts(
    monkeypatch, failure, expected_status, expected_code
):
    secret = "GH_TOKEN=super-secret provider stderr and command"
    pr_url = (
        "https://gitlab.example.com/ticketry/ticketry/pull/42"
        if failure == "unsupported"
        else "https://github.com/ticketry-hq/ticketry/pull/42"
    )
    record = _record(pr_url=pr_url)
    prior_state = record.pr_state
    prior_refreshed_at = record.pr_refreshed_at
    calls = []

    def run_gh(*args, **kwargs):
        calls.append((args, kwargs))
        if failure == "unavailable":
            raise ProviderUnavailable()
        if failure == "timeout":
            raise ProviderTimedOut(
                operation="the pull request state", timeout_seconds=120
            )
        if failure == "authentication":
            return GhCompletion(1, "", f"Bad credentials {secret}")
        if failure == "missing":
            return GhCompletion(1, "", f"HTTP 404 not found {secret}")
        if failure == "malformed":
            return GhCompletion(0, f'{{"unexpected":"{secret}"}}', "")
        return GhCompletion(1, "", secret)

    monkeypatch.setattr("apps.source_control.pull_request_state.run_gh", run_gh)

    response = _post(record)

    assert response.status_code == expected_status
    assert response.json()["code"] == expected_code
    assert secret not in response.content.decode()
    assert len(calls) == (0 if failure == "unsupported" else 1)
    record.refresh_from_db()
    assert record.pr_state == prior_state
    assert record.pr_refreshed_at == prior_refreshed_at
    assert secret not in str(ShipRecordSerializer(record).data)


def test_refresh_rejects_a_record_without_a_pull_request_before_lookup(monkeypatch):
    record = _record(pr_url=None)
    calls = []
    monkeypatch.setattr(
        "apps.source_control.pull_request_state.run_gh",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    response = _post(record)

    assert response.status_code == 422
    assert response.json()["code"] == "pull_request_url_unsupported"
    assert calls == []
    record.refresh_from_db()
    assert record.pr_state is None
    assert record.pr_refreshed_at is None


def test_refresh_rejects_records_outside_project_and_module_scope(monkeypatch):
    record = _record()
    calls = []
    monkeypatch.setattr(
        "apps.source_control.pull_request_state.run_gh",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )
    foreign_project = Project.objects.create(
        id=uuid.uuid4(), name="Foreign project", slug="FOREIGN"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=foreign_project, name="Module", level="module"
    )
    foreign_module = Issue.objects.create(
        id=uuid.uuid4(),
        project=foreign_project,
        type="module",
        issue_type=module_type,
        name="Foreign module",
        sequence_id=1,
    )

    wrong_project = _post(record, project_id=foreign_project.id)
    wrong_module = _post(record, module_id=foreign_module.id)

    assert wrong_project.status_code == 404
    assert wrong_module.status_code == 404
    assert calls == []
