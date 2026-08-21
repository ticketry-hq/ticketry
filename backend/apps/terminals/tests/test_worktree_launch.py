"""Launch wiring: agents run inside a task's worktree when one exists (#587).

W2 is *use-if-exists*: a launch never creates a worktree (that is W3's opt-in
Create button). When the owning top-level task already has a live worktree, the
launch roots both the agent ``cwd`` and the design directory there; a
sub-task resolves up to its parent's tree; everything else falls back to the
plain module folder exactly as before. These tests drive ``_build_prompt``
(which decides the root) with real ``Worktree`` rows and real directories.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from asgiref.sync import sync_to_async

import apps.terminals.consumers as consumers
from apps import worktracker_queries
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from apps.worktrees import dao as worktrees_dao

from .conftest import write_profiles

pytestmark = pytest.mark.django_db(transaction=True)

MODULE_ID = "m1"
PROJECT_ID = "p1"
DESIGN_REL = "spec/platform--m1/T42--stub-task"


def _task(task_id: str, *, parent_id=None, name: str = "Stub task") -> TaskSummary:
    return TaskSummary(
        id=task_id,
        name=name,
        issue_type="Story",
        sequence_id=42,
        state=TaskState(id="s1", name="Todo", group="unstarted"),
        project_id=PROJECT_ID,
        parent_id=parent_id,
    )


def _patch_worktracker(monkeypatch, *, task: TaskSummary) -> None:
    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Platform", project_id=PROJECT_ID)]

    async def fake_get_task_details(project_id, task_id):
        return TaskDetails(task=task)

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)


def _profile(tmp_config, module_folder) -> None:
    write_profiles(
        tmp_config,
        [
            {
                "name": "Default",
                "workspace_slug": "ws",
                "agent_prompt": None,
                "agent_prompts": {},
                "module_links": [{"module_id": MODULE_ID, "path": str(module_folder)}],
                "recent_project_id": None,
                "recent_module_ids": {},
            }
        ],
        recent=0,
    )


async def _worktree(
    tmp_path, task_id: str, *, status: str = "active", live: bool = True
):
    wt_path = tmp_path / f"wt-{task_id}"
    if live:
        wt_path.mkdir(parents=True, exist_ok=True)
    return await sync_to_async(worktrees_dao.create)(
        task_id=task_id,
        repo_root=str(tmp_path / "repo"),
        path=str(wt_path),
        branch=f"wt/CODIN-{task_id}",
        base_branch="main",
        base_commit="0" * 40,
        status=status,
    )


async def _build(
    module_folder,
    *,
    task_id="t1",
    is_planning=False,
    is_instant=False,
    instant_prompt=None,
):
    return await consumers._build_prompt(
        is_planning=is_planning,
        is_instant=is_instant,
        instant_prompt=instant_prompt,
        project_id=PROJECT_ID,
        module_id=MODULE_ID,
        task_id=task_id,
        initial_prompt=None,
        agent_run_id="a3f9c2d1deadbeef",
        module_folder=str(module_folder) if module_folder is not None else None,
    )


async def test_top_level_uses_existing_worktree(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    wt = await _worktree(tmp_path, "t1")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    assert err is None
    # Agent runs in the worktree, not the primary module folder.
    assert cwd == wt.path
    # The design dir is rooted under the worktree, so docs ride the branch.
    assert design_dir == str((Path(wt.path) / DESIGN_REL).resolve())
    assert (Path(wt.path) / DESIGN_REL).is_dir()
    assert f"Design directory: {DESIGN_REL}" in prompt


async def test_subtask_resolves_up_to_parent(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    parent_wt = await _worktree(tmp_path, "parent1")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("sub1", parent_id="parent1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="sub1")

    assert err is None
    # Sub-task runs in the PARENT's tree...
    assert cwd == parent_wt.path
    assert design_dir == str((Path(parent_wt.path) / DESIGN_REL).resolve())
    # ...and never mints its own worktree.
    assert await sync_to_async(worktrees_dao.get_by_task)("sub1") is None


async def test_no_worktree_falls_back(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    assert err is None
    # No opt-in worktree → today's behavior, byte for byte.
    assert cwd is None
    assert design_dir == str((module_folder / DESIGN_REL).resolve())


async def test_no_repo_launches_unisolated(tmp_config, tmp_path, monkeypatch):
    # A plain dir with no git repo and no worktree row.
    module_folder = tmp_path / "plain"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    # Launch proceeds in the module folder; no worktree, no error, no banner.
    assert err is None
    assert cwd is None
    assert design_dir == str((module_folder / DESIGN_REL).resolve())


async def test_stale_row_path_missing_ignored(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    await _worktree(tmp_path, "t1", live=False)  # row exists, tree removed out-of-band
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    assert err is None
    # Defends the window before reconcile prunes the row.
    assert cwd is None
    assert design_dir == str((module_folder / DESIGN_REL).resolve())


async def test_conflict_row_still_used(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    wt = await _worktree(tmp_path, "t1", status="conflict")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    assert err is None
    # A conflict row keeps a live tree → still used, so the dev resolves there.
    assert cwd == wt.path


async def test_plan_never_resolves_worktree(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    await _worktree(tmp_path, "t1")  # present, but a planning run must ignore it
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    async def fake_tasks_states(project_id, module_id):
        return [], []

    monkeypatch.setattr(worktracker_queries, "get_tasks_and_states", fake_tasks_states)

    prompt, design_dir, cwd, err = await _build(
        module_folder, task_id=None, is_planning=True
    )

    assert err is None
    # Scratch runs stay in the plain checkout (ephemeral worktrees were dropped).
    assert cwd is None
    assert design_dir == str(
        (module_folder / "spec/platform--m1/planning/a3f9c2d1").resolve()
    )


async def test_instant_never_resolves_worktree(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    await _worktree(tmp_path, "t1")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    prompt, design_dir, cwd, err = await _build(
        module_folder, task_id=None, is_instant=True, instant_prompt="fix typo"
    )

    assert err is None
    assert cwd is None


async def test_design_dir_reuses_committed_spec(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    wt = await _worktree(tmp_path, "t1")
    # A worktree carrying a committed design dir under a *renamed* task slug.
    committed = Path(wt.path) / "spec/platform--m1/T42--old-slug"
    committed.mkdir(parents=True)
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1", name="Renamed task"))

    prompt, design_dir, cwd, err = await _build(module_folder, task_id="t1")

    assert err is None
    assert cwd == wt.path
    # Reuses the committed dir by id/key prefix rather than minting a new name.
    assert design_dir == str(committed.resolve())
