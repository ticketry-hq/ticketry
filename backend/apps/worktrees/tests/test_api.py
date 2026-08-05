"""HTTP-surface tests for the opt-in worktree block (Worktrees W3, #589).

Drives the real ``git`` binary through the W1 engine; the only thing stubbed
is the local-profile resolution, so ``module_links`` points at a repo built
under ``tmp_path``. Each AC maps to at least one test here.
"""

from __future__ import annotations

import shutil
import types

import pytest
from ninja.testing import TestClient

from apps.worktrees import service
from apps.worktrees.api import router


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]

client = TestClient(router)

MODULE_ID = "mod-1"


@pytest.fixture
def profile(monkeypatch, repo):
    """Stub the local profile so module 'mod-1' maps to the test repo."""

    fake = types.SimpleNamespace(
        module_links=[{"module_id": MODULE_ID, "path": str(repo)}],
        workspace_slug="meml",
    )
    monkeypatch.setattr("apps.worktrees.api._current_profile", lambda: fake)
    return fake


def _create_record(task_id: str, repo) -> service.WorktreeStatus:
    result = service.create(
        task_id=task_id,
        working_path=str(repo),
        task_name="Worktree UI",
        ticket_seq=589,
        module_id=MODULE_ID,
    )
    assert not isinstance(result, service.NoWorktree)
    return result


# --------------------------------------------------------------------------- status


def test_get_status_none(profile, repo):
    """A task in a repo with no worktree → kind=none (offer Create)."""

    resp = client.get(f"/worktrees?task_id=t1&parent_id={MODULE_ID}&module_id={MODULE_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "none"
    assert body["task_id"] == "t1"
    assert body["top_level_task_id"] == "t1"
    assert body["is_shared"] is False


def test_get_status_no_repo(monkeypatch, tmp_path):
    """A task whose folder has no enclosing git repo → kind=no_repo."""

    bare = tmp_path / "not-a-repo"
    bare.mkdir()
    fake = types.SimpleNamespace(
        module_links=[{"module_id": MODULE_ID, "path": str(bare)}],
        workspace_slug="meml",
    )
    monkeypatch.setattr("apps.worktrees.api._current_profile", lambda: fake)

    resp = client.get(f"/worktrees?task_id=t1&module_id={MODULE_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "no_repo"
    assert body["reason"]


def test_get_status_worktree(profile, repo):
    """An active record overlays branch/base + live clean/ahead/behind."""

    _create_record("t1", repo)
    resp = client.get(f"/worktrees?task_id=t1&module_id={MODULE_ID}")
    body = resp.json()
    assert body["kind"] == "worktree"
    assert body["branch"] == "wt/CODIN-589-worktree-ui"
    assert body["base_branch"] == "main"
    assert body["path"]
    assert body["clean"] is True
    assert body["dirty"] is False
    assert body["ahead"] == 0
    assert body["behind"] == 0
    assert body["conflict"] is False


def test_get_status_subtask_shared(profile, repo):
    """A sub-task resolves up to its parent's worktree → is_shared=true."""

    _create_record("parent-1", repo)
    resp = client.get(
        f"/worktrees?task_id=sub-1&parent_id=parent-1&module_id={MODULE_ID}"
    )
    body = resp.json()
    assert body["kind"] == "worktree"
    assert body["task_id"] == "sub-1"
    assert body["top_level_task_id"] == "parent-1"
    assert body["is_shared"] is True


# --------------------------------------------------------------------------- create


def test_create(profile, repo):
    """POST create cuts a worktree off HEAD → kind=worktree."""

    resp = client.post(
        "/worktrees/t1/create",
        json={"module_id": MODULE_ID, "ticket_seq": 589, "task_name": "Worktree UI"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "worktree"
    assert body["branch"] == "wt/CODIN-589-worktree-ui"


def test_create_idempotent(profile, repo):
    """A second create returns the existing record, not a duplicate."""

    first = client.post(
        "/worktrees/t1/create",
        json={"module_id": MODULE_ID, "ticket_seq": 589, "task_name": "Worktree UI"},
    ).json()
    second = client.post(
        "/worktrees/t1/create",
        json={"module_id": MODULE_ID, "ticket_seq": 589, "task_name": "Worktree UI"},
    ).json()
    assert second["kind"] == "worktree"
    assert second["branch"] == first["branch"]
    assert service.list_worktrees() and len(service.list_worktrees()) == 1


def test_create_no_folder(monkeypatch):
    """No configured local folder → kind=no_repo, never a 500."""

    fake = types.SimpleNamespace(module_links=[], workspace_slug="meml")
    monkeypatch.setattr("apps.worktrees.api._current_profile", lambda: fake)

    resp = client.post("/worktrees/t1/create", json={"module_id": MODULE_ID})
    assert resp.status_code == 200
    assert resp.json()["kind"] == "no_repo"


# --------------------------------------------------------------------------- discard


def test_discard(profile, repo):
    """Discard removes the worktree → removed=true, then status is none again."""

    _create_record("t1", repo)
    resp = client.post(f"/worktrees/t1/discard?module_id={MODULE_ID}")
    assert resp.status_code == 200
    assert resp.json()["removed"] is True

    after = client.get(f"/worktrees?task_id=t1&module_id={MODULE_ID}").json()
    assert after["kind"] == "none"


def test_discard_missing(profile, repo):
    """Discarding a task with no worktree is a clean removed=false."""

    resp = client.post(f"/worktrees/t1/discard?module_id={MODULE_ID}")
    assert resp.status_code == 200
    assert resp.json()["removed"] is False
