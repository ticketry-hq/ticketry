"""HTTP-surface tests for the opt-in worktree block (Worktrees W3, #589).

Drives the real ``git`` binary through the W1 engine; the only thing stubbed
is the local-profile resolution, so ``module_links`` points at a repo built
under ``tmp_path``. Each AC maps to at least one test here.
"""

from __future__ import annotations

import os
import shutil

import pytest
from django.test import Client, override_settings

from apps.worktrees import service
from apps.worktrees.tests.conftest import git

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


def _create_record(
    task_id: str,
    repo,
    *,
    module_id: str = MODULE_ID,
    ticket_seq: int = 589,
) -> service.WorktreeStatus:
    result = service.create(
        task_id=task_id,
        working_path=str(repo),
        task_name="Worktree UI",
        ticket_seq=ticket_seq,
        module_id=module_id,
    )
    assert not isinstance(result, service.NoWorktree)
    return result


def _published_worktree(repo, tmp_path, *, task_id: str, ticket_seq: int):
    remote = tmp_path / f"{task_id}-remote.git"
    git(["init", "--bare", str(remote)], tmp_path)
    git(["remote", "add", "origin", str(remote)], repo)
    git(["push", "-u", "origin", "main"], repo)
    worktree = _create_record(task_id, repo, ticket_seq=ticket_seq)
    work_path = worktree.path
    work_file = f"{task_id}.txt"
    with open(f"{work_path}/{work_file}", "w") as handle:
        handle.write("published\n")
    git(["add", work_file], work_path)
    git(["commit", "-m", "published task work"], work_path)
    git(["push", "-u", "origin", worktree.branch], work_path)
    return worktree, remote


def _publish_sibling_branch(repo, worktree) -> str:
    """Publish a *different* branch whose name ends with ``worktree.branch``.

    Guards the discard prune against suffix matching: ``sibling/<branch>`` is
    its own branch, so its remote-tracking ref must outlive the discard.
    """

    sibling = f"sibling/{worktree.branch}"
    git(["branch", sibling, "main"], repo)
    git(["push", "-u", "origin", sibling], repo)
    assert git(
        ["rev-parse", "--verify", f"refs/remotes/origin/{sibling}"],
        repo,
        check=False,
    ).returncode == 0
    return sibling


def _assert_sibling_ref_survives(repo, sibling: str) -> None:
    assert git(
        ["rev-parse", "--verify", f"refs/remotes/origin/{sibling}"],
        repo,
        check=False,
    ).returncode == 0
    assert git(
        ["rev-parse", "--verify", f"refs/heads/{sibling}"],
        repo,
        check=False,
    ).returncode == 0


def _assert_complete_local_cleanup(repo, worktree, remote):
    assert not os.path.isdir(worktree.path)
    assert git(
        ["rev-parse", "--verify", f"refs/heads/{worktree.branch}"],
        repo,
        check=False,
    ).returncode != 0
    assert git(
        ["rev-parse", "--verify", f"refs/remotes/origin/{worktree.branch}"],
        repo,
        check=False,
    ).returncode != 0
    assert git(
        ["rev-parse", "--verify", f"refs/heads/{worktree.branch}"],
        remote,
        check=False,
    ).returncode == 0


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


def test_list_records_returns_only_persisted_module_owners(profile, repo, monkeypatch):
    _create_record("t1", repo)
    _create_record("t2", repo, module_id="mod-2", ticket_seq=590)
    monkeypatch.setattr(
        "apps.worktrees.service.status",
        lambda _task_id: pytest.fail("record listing must not inspect live git status"),
    )

    resp = client.get(f"/worktrees/records?module_id={MODULE_ID}")

    assert resp.status_code == 200
    assert resp.json() == [{"task_id": "t1"}]


def test_list_records_requires_module_id():
    resp = client.get("/worktrees/records")

    assert resp.status_code == 400
    assert "module_id" in resp.json()


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
    monkeypatch.setattr(
        "apps.worktrees.api.resolve_module_path", lambda _module_id: str(bare)
    )

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

    monkeypatch.setattr(
        "apps.worktrees.api.resolve_module_path", lambda _module_id: None
    )

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


def test_discard_clean_removes_checkout_and_local_refs_but_keeps_remote_branch(
    profile, repo, tmp_path
):
    worktree, remote = _published_worktree(
        repo, tmp_path, task_id="clean", ticket_seq=1036
    )
    sibling = _publish_sibling_branch(repo, worktree)

    response = client.post(f"/worktrees/clean/discard?module_id={MODULE_ID}")

    assert response.status_code == 200
    assert response.json()["removed"] is True
    _assert_complete_local_cleanup(repo, worktree, remote)
    _assert_sibling_ref_survives(repo, sibling)


def test_discard_dirty_removes_checkout_and_local_refs_but_keeps_remote_branch(
    profile, repo, tmp_path
):
    worktree, remote = _published_worktree(
        repo, tmp_path, task_id="dirty", ticket_seq=1037
    )
    with open(f"{worktree.path}/local-commit.txt", "w") as handle:
        handle.write("local commit\n")
    git(["add", "local-commit.txt"], worktree.path)
    git(["commit", "-m", "unpushed local commit"], worktree.path)
    with open(f"{worktree.path}/uncommitted.txt", "w") as handle:
        handle.write("uncommitted\n")

    response = client.post(f"/worktrees/dirty/discard?module_id={MODULE_ID}")

    assert response.status_code == 200
    assert response.json()["removed"] is True
    _assert_complete_local_cleanup(repo, worktree, remote)


def test_discard_finishes_cleanup_after_out_of_band_worktree_removal(
    profile, repo, tmp_path
):
    worktree, remote = _published_worktree(
        repo, tmp_path, task_id="out-of-band", ticket_seq=1038
    )
    git(["worktree", "remove", "--force", worktree.path], repo)

    response = client.post(
        f"/worktrees/out-of-band/discard?module_id={MODULE_ID}"
    )

    assert response.status_code == 200
    assert response.json()["removed"] is True
    _assert_complete_local_cleanup(repo, worktree, remote)


def test_discard_missing(profile, repo):
    """Discarding a task with no worktree is a clean removed=false."""

    resp = client.post(f"/worktrees/t1/discard?module_id={MODULE_ID}")
    assert resp.status_code == 200
    assert resp.json()["removed"] is False
