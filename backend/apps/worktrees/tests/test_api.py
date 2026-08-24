"""HTTP-surface tests for the opt-in worktree block (Worktrees W3, #589).

Drives the real ``git`` binary through the W1 engine; the only thing stubbed
is the local-profile resolution, so ``module_links`` points at a repo built
under ``tmp_path``. Each AC maps to at least one test here.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client, override_settings

from apps.worktrees import service
from apps.worktrees.models import Worktree


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def get(self, path, *args, **kwargs):
        return super().get(f"/api{path}", *args, **kwargs)

    def post(self, path, *args, json=None, **kwargs):
        if json is not None:
            kwargs.update(data=json, content_type="application/json")
        return super().post(f"/api{path}", *args, **kwargs)


client = HostClient()

MODULE_ID = "mod-1"
PROJECT_UUID = "11111111-1111-4111-8111-111111111111"
MODULE_UUID = "22222222-2222-4222-8222-222222222222"
OTHER_MODULE_UUID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture
def profile(monkeypatch, repo):
    """Stub the typed Module link so module 'mod-1' maps to the test repo."""

    monkeypatch.setattr(
        "apps.worktrees.api.resolve_module_path",
        lambda module_id: str(repo) if module_id == MODULE_ID else None,
    )
    return repo


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


def _indexed_worktree(
    *,
    task_id: str,
    created_at: str,
    module_id: str = MODULE_UUID,
    project_id: str = PROJECT_UUID,
    status: str = "active",
    ephemeral: bool = False,
) -> Worktree:
    return Worktree.objects.create(
        id=f"worktree-{task_id}",
        task_id=task_id,
        project_id=project_id,
        module_id=module_id,
        ticket_seq=int(task_id.removeprefix("task-")),
        repo_root="/repo",
        path=f"/worktrees/{task_id}",
        branch=f"wt/CODING-{task_id.removeprefix('task-')}",
        base_branch="main",
        base_commit="a" * 40,
        status=status,
        ephemeral=ephemeral,
        created_at=created_at,
        updated_at=created_at,
    )


def test_list_module_worktrees_is_scoped_ordered_and_carries_anchor_identity():
    _indexed_worktree(task_id="task-2", created_at="2026-08-24T10:00:00+00:00")
    _indexed_worktree(task_id="task-1", created_at="2026-08-24T09:00:00+00:00")
    _indexed_worktree(
        task_id="task-3",
        created_at="2026-08-24T11:00:00+00:00",
        status="conflict",
    )
    _indexed_worktree(
        task_id="task-4",
        created_at="2026-08-24T12:00:00+00:00",
        module_id=OTHER_MODULE_UUID,
    )
    _indexed_worktree(
        task_id="task-5",
        created_at="2026-08-24T13:00:00+00:00",
        ephemeral=True,
    )

    response = client.get(
        f"/work-tracker/projects/{PROJECT_UUID}/modules/{MODULE_UUID}/worktrees"
    )

    assert response.status_code == 200
    assert [row["task_id"] for row in response.json()] == [
        "task-1",
        "task-2",
        "task-3",
    ]
    assert response.json()[0] == {
        "id": "worktree-task-1",
        "task_id": "task-1",
        "project_id": PROJECT_UUID,
        "module_id": MODULE_UUID,
        "ticket_seq": 1,
        "path": "/worktrees/task-1",
        "branch": "wt/CODING-1",
        "base_branch": "main",
        "status": "active",
        "created_at": "2026-08-24T09:00:00+00:00",
    }


# --------------------------------------------------------------------------- status


def test_get_status_none(profile, repo):
    """A task in a repo with no worktree → kind=none (offer Create)."""

    resp = client.get(
        f"/worktrees?task_id=t1&parent_id={MODULE_ID}&module_id={MODULE_ID}"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "none"
    assert body["task_id"] == "t1"
    assert body["top_level_task_id"] == "t1"
    assert body["is_shared"] is False


def test_get_status_requires_task_id():
    resp = client.get("/worktrees")

    assert resp.status_code == 400
    assert "task_id" in resp.json()


def test_get_status_with_malformed_module_id_returns_no_repo():
    resp = client.get("/worktrees?task_id=t1&module_id=not-a-uuid")

    assert resp.status_code == 200
    assert resp.json()["kind"] == "no_repo"


@override_settings(
    WORKTRACKER_DISABLE_AUTH=False,
    WORKTRACKER_API_TOKEN="worktree-secret",
)
def test_worktree_routes_use_default_api_key_authentication(profile):
    rejected = client.get(f"/worktrees?task_id=t1&module_id={MODULE_ID}")
    accepted = client.get(
        f"/worktrees?task_id=t1&module_id={MODULE_ID}",
        HTTP_X_API_KEY="worktree-secret",
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 200


def test_get_status_no_repo(monkeypatch, tmp_path):
    """A task whose folder has no enclosing git repo → kind=no_repo."""

    bare = tmp_path / "not-a-repo"
    bare.mkdir()
    monkeypatch.setattr("apps.worktrees.api.resolve_module_path", lambda _module_id: str(bare))

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

    monkeypatch.setattr("apps.worktrees.api.resolve_module_path", lambda _module_id: None)

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
