from __future__ import annotations

import shutil
import uuid
from unittest.mock import patch

import pytest
from django.test import Client
from worktracker.models import Issue, IssueType

from apps.source_control.actions.action_checkout import task_checkout_for_action
from apps.source_control.actions.commit import commit_worktree_changes
from apps.source_control.actions.stacked_action import commit_and_push
from apps.source_control.models import (
    CHECKOUT_BASE,
    CHECKOUT_WORKTREE,
    PR_OPEN,
    STEP_DONE,
    STEP_FAILED,
    STEP_SKIPPED,
    ShipRecord,
)
from apps.source_control.tests.commit_fixtures import (
    install_hook,
    isolate_generators,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git
from apps.source_control.tests.pull_request_fixtures import install_gh
from apps.source_control.tests.push_fixtures import (
    attach_remote,
    bare_remote,
    publish_from_elsewhere,
)
from apps.worktrees import service as worktree_service
from apps.worktrees.models import Worktree

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]

PR_URL = "https://github.com/ticketry-hq/ticketry/pull/42"


class HostClient(Client):
    def post(self, path, *args, **kwargs):
        return super().post(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def action_environment(settings, monkeypatch, tmp_path):
    settings.WORKTRACKER_DISABLE_AUTH = True
    for name in ("GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def remote(tmp_path, repo):
    path = bare_remote(tmp_path)
    attach_remote(repo, path)
    git(["push", "--quiet", "origin", "refs/heads/main:refs/heads/main"], repo)
    git(["remote", "set-head", "origin", "main"], repo)
    return path


def _post(path: str, **body):
    return client.post(path, data=body, content_type="application/json")


def _worktree_body(**overrides):
    return {"task_id": TASK_ID, "module_id": MODULE_ID, **overrides}


def test_push_action_records_ordered_full_commits_and_returns_the_same_row(
    checkout, remote
):
    for number in (1, 2):
        (checkout / "kept.txt").write_text(f"local commit {number}\n")
        git(["commit", "--quiet", "--all", "-m", f"local {number}"], checkout)
    (checkout / "arrived.txt").write_text("committed by the action\n")

    response = _post("/worktrees/changes/commit-push", **_worktree_body())

    assert response.status_code == 200, response.content
    body = response.json()
    expected = git(
        ["rev-list", "--reverse", "origin/main..HEAD"], checkout
    ).stdout.splitlines()
    record = ShipRecord.objects.get()
    assert body["action_id"] == str(record.action_id)
    assert body["ship_record"]["id"] == str(record.id)
    assert body["commit_shas"] == expected
    assert record.commit_shas == expected
    assert all(len(sha) == 40 for sha in record.commit_shas)
    assert record.commit_outcome["status"] == STEP_DONE
    assert record.push_outcome["status"] == STEP_DONE
    assert record.create_pr_outcome["status"] == STEP_SKIPPED


def test_pull_request_failure_and_push_failure_keep_partial_facts(
    checkout, remote, action_environment, tmp_path
):
    install_gh(
        action_environment,
        tmp_path / "gh-logs",
        create_exit=1,
        create_prints="token=secret raw provider output",
    )
    (checkout / "kept.txt").write_text("first attempt\n")
    response = _post("/worktrees/changes/commit-push-pr", **_worktree_body())
    assert response.status_code == 200, response.content
    pr_failure = ShipRecord.objects.get()
    assert pr_failure.commit_outcome["status"] == STEP_DONE
    assert pr_failure.push_outcome["status"] == STEP_DONE
    assert pr_failure.create_pr_outcome["status"] == STEP_FAILED
    assert "secret" not in str(pr_failure.create_pr_outcome)

    branch = git(["symbolic-ref", "--short", "HEAD"], checkout).stdout.strip()
    publish_from_elsewhere(tmp_path, remote, branch)
    (checkout / "kept.txt").write_text("second attempt\n")
    response = _post("/worktrees/changes/commit-push-pr", **_worktree_body())
    assert response.status_code == 200, response.content
    push_failure = ShipRecord.objects.order_by("-action_at").first()
    assert push_failure.commit_outcome["status"] == STEP_DONE
    assert push_failure.push_outcome["status"] == STEP_FAILED
    assert push_failure.create_pr_outcome["status"] == STEP_SKIPPED


def test_created_pull_request_facts_are_open_and_sanitized(
    checkout, remote, action_environment, tmp_path
):
    install_gh(action_environment, tmp_path / "gh-logs", create_prints=PR_URL)
    (checkout / "kept.txt").write_text("ship with PR\n")

    response = _post("/worktrees/changes/commit-push-pr", **_worktree_body())

    assert response.status_code == 200, response.content
    record = ShipRecord.objects.get()
    assert record.pr_url == PR_URL
    assert record.pr_number == 42
    assert record.pr_state == PR_OPEN
    assert record.pr_refreshed_at is None
    assert "GH_TOKEN" not in str(response.json()["ship_record"])


def test_worktree_pull_request_retry_writes_a_separate_ship_record(
    checkout, remote, action_environment, tmp_path
):
    gh_logs = tmp_path / "gh-logs"
    install_gh(action_environment, gh_logs, create_exit=1)
    (checkout / "kept.txt").write_text("retry this PR\n")

    first = _post("/worktrees/changes/commit-push-pr", **_worktree_body())

    assert first.status_code == 200, first.content
    failed_record = ShipRecord.objects.get()
    assert failed_record.create_pr_outcome["status"] == STEP_FAILED
    install_gh(action_environment, gh_logs, create_prints=PR_URL)

    retry = _post("/worktrees/changes/pull-request", **_worktree_body())

    assert retry.status_code == 200, retry.content
    body = retry.json()
    retry_record = ShipRecord.objects.get(pk=body["ship_record"]["id"])
    assert ShipRecord.objects.count() == 2
    assert body["action_id"] == str(retry_record.action_id)
    assert retry_record.id != failed_record.id
    assert retry_record.task_id == uuid.UUID(TASK_ID)
    assert retry_record.commit_outcome["status"] == STEP_SKIPPED
    assert retry_record.push_outcome["status"] == STEP_SKIPPED
    assert retry_record.create_pr_outcome["status"] == STEP_DONE
    assert retry_record.pr_url == PR_URL
    assert retry_record.pr_number == 42
    failed_record.refresh_from_db()
    assert failed_record.create_pr_outcome["status"] == STEP_FAILED
    assert failed_record.pr_url is None


def test_module_pull_request_retry_writes_a_base_checkout_ship_record(
    repo, linked_module, remote, action_environment, tmp_path
):
    gh_logs = tmp_path / "gh-logs"
    install_gh(action_environment, gh_logs, create_exit=1)
    git(["checkout", "--quiet", "-b", "module/retry-pr"], repo)
    (repo / "kept.txt").write_text("retry the module PR\n")
    request = {"module_id": str(linked_module.id)}

    first = _post("/modules/changes/commit-push-pr", **request)

    assert first.status_code == 200, first.content
    failed_record = ShipRecord.objects.get()
    assert failed_record.create_pr_outcome["status"] == STEP_FAILED
    install_gh(action_environment, gh_logs, create_prints=PR_URL)

    retry = _post("/modules/changes/pull-request", **request)

    assert retry.status_code == 200, retry.content
    body = retry.json()
    retry_record = ShipRecord.objects.get(pk=body["ship_record"]["id"])
    assert ShipRecord.objects.count() == 2
    assert body["action_id"] == str(retry_record.action_id)
    assert retry_record.id != failed_record.id
    assert retry_record.checkout_kind == CHECKOUT_BASE
    assert retry_record.task_id is None
    assert retry_record.commit_outcome["status"] == STEP_SKIPPED
    assert retry_record.push_outcome["status"] == STEP_SKIPPED
    assert retry_record.create_pr_outcome["status"] == STEP_DONE
    assert retry_record.pr_url == PR_URL
    assert retry_record.pr_number == 42
    failed_record.refresh_from_db()
    assert failed_record.create_pr_outcome["status"] == STEP_FAILED
    assert failed_record.pr_url is None


def test_commit_failure_writes_one_sanitized_record(checkout, repo, action_environment):
    install_hook(
        repo,
        "pre-commit",
        'echo "credential=top-secret raw hook output"\nexit 1',
    )
    (checkout / "kept.txt").write_text("hook refusal\n")

    response = _post("/worktrees/changes/commit", **_worktree_body())

    assert response.status_code == 409
    record = ShipRecord.objects.get()
    assert record.commit_outcome["status"] == STEP_FAILED
    assert record.push_outcome["status"] == STEP_SKIPPED
    assert record.create_pr_outcome["status"] == STEP_SKIPPED
    assert "top-secret" not in str(record.commit_outcome)


def test_preflight_rejection_before_commit_leaves_no_record(checkout):
    (checkout / "kept.txt").write_text("no remote configured\n")

    response = _post("/worktrees/changes/commit-push", **_worktree_body())

    assert response.status_code == 409
    assert not ShipRecord.objects.exists()


def test_shared_subtask_uses_the_server_resolved_anchor_owner(checkout):
    anchor = Issue.objects.get(pk=TASK_ID)
    subtask = Issue.objects.create(
        id=uuid.uuid4(),
        project=anchor.project,
        type="task",
        issue_type=anchor.issue_type,
        parent=anchor,
        module=anchor.module,
        name="Shared subtask",
        sequence_id=20,
    )
    (checkout / "kept.txt").write_text("changed from the subtask\n")

    response = _post(
        "/worktrees/changes/commit",
        task_id=str(subtask.id),
    )

    assert response.status_code == 200, response.content
    record = ShipRecord.objects.get()
    assert record.task_id == anchor.id
    assert record.task_id != subtask.id
    assert record.module_id == anchor.module_id


def test_client_context_cannot_redirect_an_action_to_another_tasks_worktree(checkout):
    anchor = Issue.objects.get(pk=TASK_ID)
    module_type = IssueType.objects.get(project=anchor.project, level="module")
    other_module = Issue.objects.create(
        id=uuid.uuid4(),
        project=anchor.project,
        type="module",
        issue_type=module_type,
        name="Other module",
        sequence_id=21,
    )
    other_task = Issue.objects.create(
        id=uuid.uuid4(),
        project=anchor.project,
        type="task",
        issue_type=anchor.issue_type,
        parent=other_module,
        module=other_module,
        name="Other task",
        sequence_id=22,
    )
    (checkout / "kept.txt").write_text("must remain uncommitted\n")
    before = git(["rev-parse", "HEAD"], checkout).stdout.strip()

    response = _post(
        "/worktrees/changes/commit",
        task_id=str(other_task.id),
        parent_id=TASK_ID,
        module_id=MODULE_ID,
    )

    assert response.status_code == 409
    assert git(["rev-parse", "HEAD"], checkout).stdout.strip() == before
    assert git(["status", "--porcelain"], checkout).stdout.strip()
    assert not ShipRecord.objects.exists()


def test_base_checkout_has_no_task_and_worktree_discard_keeps_history(
    repo, linked_module, checkout
):
    (repo / "kept.txt").write_text("module change\n")
    response = _post(
        "/modules/changes/commit",
        module_id=str(linked_module.id),
    )
    assert response.status_code == 200, response.content
    base_record = ShipRecord.objects.get(module=linked_module)
    assert base_record.checkout_kind == CHECKOUT_BASE
    assert base_record.task_id is None

    (checkout / "kept.txt").write_text("task change\n")
    response = _post("/worktrees/changes/commit", **_worktree_body())
    assert response.status_code == 200, response.content
    worktree_record = ShipRecord.objects.get(task_id=TASK_ID)
    assert worktree_record.checkout_kind == CHECKOUT_WORKTREE
    assert worktree_service.discard(TASK_ID).removed is True
    assert ShipRecord.objects.filter(pk=worktree_record.id).exists()


def test_successful_action_persists_after_worktree_index_row_disappears(
    checkout, remote
):
    resolved_checkout = task_checkout_for_action(TASK_ID, module_id=MODULE_ID)
    Worktree.objects.get(task_id=TASK_ID).delete()
    (checkout / "kept.txt").write_text("ship after index cleanup\n")

    outcome = commit_and_push(resolved_checkout)

    record = ShipRecord.objects.get()
    assert outcome.ship_record == record
    assert record.module_id == uuid.UUID(MODULE_ID)
    assert record.task_id == uuid.UUID(TASK_ID)


def test_successful_action_ignores_noncanonical_worktree_index_ids(checkout, remote):
    resolved_checkout = task_checkout_for_action(TASK_ID, module_id=MODULE_ID)
    Worktree.objects.filter(task_id=TASK_ID).update(
        task_id=uuid.UUID(TASK_ID).hex,
        module_id=uuid.UUID(MODULE_ID).hex,
    )
    (checkout / "kept.txt").write_text("ship with compact index ids\n")

    outcome = commit_and_push(resolved_checkout)

    record = ShipRecord.objects.get()
    assert outcome.ship_record == record
    assert record.module_id == uuid.UUID(MODULE_ID)
    assert record.task_id == uuid.UUID(TASK_ID)


def test_reusing_action_identifier_returns_one_existing_record(checkout):
    action_id = uuid.uuid4()
    (checkout / "kept.txt").write_text("one action\n")

    first = commit_worktree_changes(
        TASK_ID,
        module_id=MODULE_ID,
        action_id=action_id,
    )
    second = commit_worktree_changes(
        TASK_ID,
        module_id=MODULE_ID,
        action_id=action_id,
    )

    assert ShipRecord.objects.filter(action_id=action_id).count() == 1
    assert first.ship_record.id == second.ship_record.id


def test_http_retry_reuses_the_returned_action_identifier(checkout, remote):
    (checkout / "kept.txt").write_text("first request\n")
    first_response = _post(
        "/worktrees/changes/commit-push",
        **_worktree_body(),
    )
    assert first_response.status_code == 200, first_response.content
    first_body = first_response.json()

    (checkout / "kept.txt").write_text("retried request\n")
    retry_response = _post(
        "/worktrees/changes/commit-push",
        **_worktree_body(action_id=first_body["action_id"]),
    )

    assert retry_response.status_code == 200, retry_response.content
    assert ShipRecord.objects.count() == 1
    assert ShipRecord.objects.filter(action_id=first_body["action_id"]).count() == 1
    assert retry_response.json()["ship_record"]["id"] == first_body["ship_record"]["id"]


def test_persistence_failure_is_safe_and_preserves_known_action_facts(checkout, remote):
    (checkout / "kept.txt").write_text("git still succeeds\n")
    with patch.object(
        ShipRecord.objects,
        "get_or_create",
        side_effect=RuntimeError("postgres://admin:secret@host/raw-command"),
    ):
        response = _post("/worktrees/changes/commit-push", **_worktree_body())

    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "ship_record_persistence_failed"
    assert body["action_result"]["commit_sha"]
    assert body["action_result"]["pushed_sha"]
    assert body["action_result"]["ship_record"] is None
    assert "secret" not in response.content.decode()
    assert "raw-command" not in response.content.decode()
    assert not ShipRecord.objects.exists()
