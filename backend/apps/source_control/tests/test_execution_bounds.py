"""The bounds that keep a review read safe (#980, AC 4).

Three properties, each driven through the HTTP surface: a wedged git is
stopped by the wall-clock budget, oversized output never becomes a partial
answer presented as a whole one, and no failure carries git's own output back
to the caller.

The slow and noisy cases install a real executable named ``git`` earlier on
PATH. That is a real subprocess taking a real amount of time — the timeout and
the cap are exercised, not simulated.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.changes import change_status, file_diff
from apps.source_control.clients import git_cli
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def get(self, path, *args, **kwargs):
        return super().get(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


def read_changes():
    return client.get(
        "/worktrees/changes", data={"task_id": TASK_ID, "module_id": MODULE_ID}
    )


def read_diff(path: str):
    return client.get(
        "/worktrees/changes/file-diff",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, "path": path},
    )


def install_fake_git(tmp_path, monkeypatch, script: str) -> None:
    """Put an executable named ``git`` at the front of PATH."""

    directory = tmp_path / "fake-bin"
    directory.mkdir(exist_ok=True)
    fake = directory / "git"
    fake.write_text(script)
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{directory}:{shutil.os.environ['PATH']}")


def test_a_wedged_git_is_stopped_by_the_wall_clock_budget(
    checkout, tmp_path, monkeypatch
):
    install_fake_git(tmp_path, monkeypatch, "#!/bin/sh\nsleep 30\n")
    monkeypatch.setattr(git_cli, "DEFAULT_TIMEOUT_SECONDS", 0.3)

    response = read_changes()

    assert response.status_code == 504
    body = response.json()
    assert body["code"] == "git_timeout"
    assert body["timeout_seconds"] == 0.3


def test_a_failing_git_returns_a_curated_error_without_its_output(
    checkout, tmp_path, monkeypatch
):
    install_fake_git(
        tmp_path,
        monkeypatch,
        "#!/bin/sh\n"
        'echo "fatal: /Users/someone/secret-repo is broken" >&2\n'
        "exit 3\n",
    )

    response = read_changes()

    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "git_failed"
    assert body["exit_code"] == 3
    assert body["stderr_bytes"] > 0
    # The message says what failed, never what git said about it.
    assert "secret-repo" not in response.content.decode()
    assert "fatal" not in response.content.decode()


def test_a_missing_git_binary_is_reported_as_unavailable(
    checkout, tmp_path, monkeypatch
):
    empty = tmp_path / "empty-bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))

    response = read_changes()

    assert response.status_code == 503
    assert response.json()["code"] == "git_unavailable"


def test_a_change_set_past_the_output_cap_is_refused_not_truncated(
    checkout, monkeypatch
):
    monkeypatch.setattr(git_cli, "DEFAULT_OUTPUT_LIMIT_BYTES", 64)
    for index in range(20):
        (checkout / f"file-{index}.txt").write_text("content\n")

    response = read_changes()

    assert response.status_code == 413
    assert response.json()["code"] == "changes_too_large"


def test_a_patch_past_its_cap_is_truncated_at_a_line_and_says_so(
    checkout, monkeypatch
):
    monkeypatch.setattr(file_diff, "DIFF_OUTPUT_LIMIT_BYTES", 2048)
    (checkout / "kept.txt").write_text("".join(f"line {n}\n" for n in range(2000)))

    response = read_diff("kept.txt")

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is True
    assert len(body["patch"].encode()) <= 2048
    assert body["patch"].endswith("\n")


def test_a_checkout_that_stopped_being_a_git_worktree_reports_absence(
    checkout, monkeypatch
):
    shutil.rmtree(checkout / ".git", ignore_errors=True)
    (checkout / ".git").unlink(missing_ok=True)

    response = read_changes()

    assert response.status_code == 200
    assert response.json()["kind"] == "no_worktree"


def test_the_status_read_forces_a_stable_locale(checkout, tmp_path, monkeypatch):
    """Parsed output must not depend on the developer's locale."""

    recorded = tmp_path / "recorded-locale"
    install_fake_git(
        tmp_path,
        monkeypatch,
        f'#!/bin/sh\nprintf "%s" "$LC_ALL" >> {recorded}\nexit 128\n',
    )

    read_changes()

    assert recorded.read_text().startswith("C")


def test_the_untracked_line_count_survives_an_unreadable_file(checkout, monkeypatch):
    monkeypatch.setattr(
        change_status, "count_untracked_file", lambda absolute_path: None
    )
    (checkout / "fresh.txt").write_text("alpha\n")

    response = read_changes()

    assert response.status_code == 200
    entry = response.json()["files"][0]
    assert entry["path"] == "fresh.txt"
    assert entry["insertions"] is None
