"""Launch characterization for the read-only compatibility boundary (#765).

W2 is still *use-if-exists*: a launch never creates a worktree, a top-level
task's live checkout roots both the agent ``cwd`` and the design directory, a
sub-task resolves up to its parent's tree, a missing or stale checkout falls
back to the module folder, and planning and instant runs keep their own
run-scoped design directories. What changed is who decides: Rust owns
Documents and Worktrees, so these tests drive ``_build_prompt`` against the
compatibility port rather than against ORM rows Django may no longer read.

Two things are asserted here that the Rust suite cannot see:

* what Django actually puts on the wire — identities and a scope, never a
  path, a Git argument, a document body, or a model field; and
* that a boundary refusal fails the launch instead of guessing a directory.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

import apps.terminals.consumers as consumers
from apps import worktracker_queries
from apps.terminals import launch_paths_port, prompt_builder
from apps.terminals.launch_paths_port import LaunchPaths, LaunchPathsUnavailable
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary

from .conftest import write_profiles

pytestmark = pytest.mark.django_db(transaction=True)

MODULE_ID = "m1"
PROJECT_ID = "p1"
RUN_ID = "a3f9c2d1deadbeef"
DESIGN_REL = "spec/platform--m1/T42--stub-task"
PLANNING_REL = "spec/platform--m1/planning/a3f9c2d1"

#: The real transport, captured before the package-wide stub replaces it,
#: so the two wire-contract tests below exercise the shipping call path.
REAL_RESOLVE = launch_paths_port.resolve


class RecordingPort:
    """A stand-in for the Rust boundary that records what it was asked."""

    def __init__(self, paths: LaunchPaths | None = None) -> None:
        self.paths = paths or LaunchPaths()
        self.requests: list[dict] = []

    def __call__(self, **kwargs) -> LaunchPaths:
        self.requests.append(kwargs)
        return self.paths

    @property
    def request(self) -> dict:
        assert len(self.requests) == 1, f"expected one resolution, got {self.requests}"
        return self.requests[0]


def _install(monkeypatch, port) -> None:
    monkeypatch.setattr(launch_paths_port, "resolve", port)


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

    async def fake_tasks_states(project_id, module_id):
        return [], []

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)
    monkeypatch.setattr(worktracker_queries, "get_tasks_and_states", fake_tasks_states)


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


def _worktree_paths(checkout: str) -> LaunchPaths:
    """What Rust answers for a task rooted in its owner's live checkout."""

    return LaunchPaths(
        working_directory=checkout,
        design_directory=f"{checkout}/{DESIGN_REL}",
        design_directory_relative=DESIGN_REL,
        worktree_used=True,
        worktree_state="active",
        worktree_reason="used",
    )


def _module_folder_paths(module_folder) -> LaunchPaths:
    """What Rust answers when the launch is not isolated."""

    return LaunchPaths(
        working_directory=None,
        design_directory=f"{module_folder}/{DESIGN_REL}",
        design_directory_relative=DESIGN_REL,
        worktree_used=False,
        worktree_reason="none",
    )


async def _build(
    *,
    task_id="t1",
    is_planning=False,
    is_instant=False,
    instant_prompt=None,
    doc_rel_path=None,
    doc_id=None,
    is_doc_chat=False,
):
    return await consumers._build_prompt(
        0,
        is_planning=is_planning,
        is_instant=is_instant,
        instant_prompt=instant_prompt,
        project_id=PROJECT_ID,
        module_id=MODULE_ID,
        task_id=task_id,
        initial_prompt=None,
        agent_run_id=RUN_ID,
        is_doc_chat=is_doc_chat,
        doc_rel_path=doc_rel_path,
        doc_id=doc_id,
    )


# ---------------------------------------------------------------------------
# 1. What crosses the boundary
# ---------------------------------------------------------------------------

#: Nothing a caller could aim. The boundary rejects these fields outright, so
#: Django must never learn to send one.
FORBIDDEN_REQUEST_KEYS = {
    "path",
    "cwd",
    "root_dir",
    "design_dir",
    "module_folder",
    "repo_root",
    "branch",
    "base_branch",
    "git",
    "args",
    "command",
    "content",
    "rel_path",
    "status",
    "ephemeral",
}


async def test_a_task_launch_asks_with_identities_only(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    port = RecordingPort(_module_folder_paths(module_folder))
    _install(monkeypatch, port)

    await _build(task_id="t1")

    assert port.request == {
        "scope": "task",
        "agent_run_id": RUN_ID,
        "project_id": PROJECT_ID,
        "module_id": MODULE_ID,
        "task_id": "t1",
        "document_id": None,
    }
    assert not FORBIDDEN_REQUEST_KEYS & set(port.request)


def test_the_port_puts_no_place_or_command_on_the_wire(monkeypatch):
    sent: dict = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True, "paths": {"working_directory": None}}

    def fake_post(url, json, headers, timeout):
        sent["url"] = url
        sent["json"] = json
        return Response()

    monkeypatch.setenv("WORKTRACKER_MCP_URL", "http://127.0.0.1:9911/mcp")
    monkeypatch.setenv(launch_paths_port.CREDENTIAL_ENV, "secret")
    monkeypatch.setattr(launch_paths_port.httpx, "post", fake_post)

    REAL_RESOLVE(
        scope="task",
        agent_run_id=RUN_ID,
        project_id=PROJECT_ID,
        module_id=MODULE_ID,
        task_id="t1",
    )

    assert sent["url"] == "http://127.0.0.1:9911/workspace/launch-paths"
    assert set(sent["json"]) == {
        "version",
        "scope",
        "agent_run_id",
        "project_id",
        "module_id",
        "task_id",
        "document_id",
    }
    assert not FORBIDDEN_REQUEST_KEYS & set(sent["json"])


def test_an_unconfigured_runtime_is_refused_not_guessed(monkeypatch):
    monkeypatch.delenv("WORKTRACKER_MCP_URL", raising=False)

    with pytest.raises(LaunchPathsUnavailable) as refusal:
        REAL_RESOLVE(
            scope="task",
            agent_run_id=RUN_ID,
            project_id=PROJECT_ID,
            task_id="t1",
        )

    assert refusal.value.code == "launch_paths_unconfigured"


async def test_a_refused_resolution_fails_the_launch(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))

    def refuse(**kwargs):
        raise LaunchPathsUnavailable("launch_paths_unreachable")

    _install(monkeypatch, refuse)

    prompt, design_dir, cwd, err = await _build(task_id="t1")

    # No prompt, no directory, no silent module-folder launch.
    assert (prompt, design_dir, cwd) == (None, None, None)
    assert err == "launch_paths_unreachable"


# ---------------------------------------------------------------------------
# 2. Task launches — use if exists
# ---------------------------------------------------------------------------


async def test_top_level_uses_existing_worktree(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    checkout = str(tmp_path / "wt-t1")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    _install(monkeypatch, RecordingPort(_worktree_paths(checkout)))

    prompt, design_dir, cwd, err = await _build(task_id="t1")

    assert err is None
    # Agent runs in the worktree, not the primary module folder.
    assert cwd == checkout
    # The design dir is rooted under the worktree, so docs ride the branch.
    assert design_dir == f"{checkout}/{DESIGN_REL}"
    assert f"Design directory: {DESIGN_REL}" in prompt


async def test_subtask_asks_for_itself_and_runs_in_the_shared_checkout(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    checkout = str(tmp_path / "wt-parent1")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("sub1", parent_id="parent1"))
    shared = replace(_worktree_paths(checkout), worktree_reason="used")
    port = RecordingPort(shared)
    _install(monkeypatch, port)

    prompt, design_dir, cwd, err = await _build(task_id="sub1")

    assert err is None
    # Django names the child; ownership is resolved on the other side of the
    # boundary, so no parent identity is submitted as authority.
    assert port.request["task_id"] == "sub1"
    assert cwd == checkout


async def test_a_conflict_checkout_is_still_where_the_run_happens(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    checkout = str(tmp_path / "wt-t1")
    conflicted = replace(_worktree_paths(checkout), worktree_state="conflict")
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    _install(monkeypatch, RecordingPort(conflicted))

    prompt, design_dir, cwd, err = await _build(task_id="t1")

    assert err is None
    # A stopped merge is resolved in place, so the run goes back in there.
    assert cwd == checkout


@pytest.mark.parametrize("reason", ["none", "checkout_missing"])
async def test_no_live_worktree_falls_back_to_the_module_folder(
    tmp_config, tmp_path, monkeypatch, reason
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    fallback = replace(_module_folder_paths(module_folder), worktree_reason=reason)
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    _install(monkeypatch, RecordingPort(fallback))

    prompt, design_dir, cwd, err = await _build(task_id="t1")

    assert err is None
    # No cwd override: the launch keeps the module folder it already resolved.
    assert cwd is None
    assert design_dir == f"{module_folder}/{DESIGN_REL}"


async def test_an_unresolvable_root_still_launches_without_documents(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    _install(monkeypatch, RecordingPort(LaunchPaths(worktree_reason="none")))

    prompt, design_dir, cwd, err = await _build(task_id="t1")

    assert err is None
    assert design_dir is None
    # The prompt must not name a directory the run cannot write to.
    assert "Design directory:" not in prompt


# ---------------------------------------------------------------------------
# 3. Scratch launches — run-scoped, never a worktree
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "flag,scope",
    [("is_planning", "plan"), ("is_instant", "instant")],
)
async def test_scratch_runs_keep_their_run_scoped_design_directory(
    tmp_config, tmp_path, monkeypatch, flag, scope
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    port = RecordingPort(
        LaunchPaths(
            design_directory=f"{module_folder}/{PLANNING_REL}",
            design_directory_relative=PLANNING_REL,
            module_directory_name="platform--m1",
            worktree_reason="not_applicable",
        )
    )
    _install(monkeypatch, port)

    prompt, design_dir, cwd, err = await _build(
        task_id=None, instant_prompt="fix typo", **{flag: True}
    )

    assert err is None
    # A scratch launch never asks about, and never mints, a task worktree.
    assert port.request["scope"] == scope
    assert port.request["task_id"] is None
    assert cwd is None
    assert design_dir == f"{module_folder}/{PLANNING_REL}"
    assert PLANNING_REL in prompt


async def test_planning_prompt_names_the_canonical_directory_rust_derived(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    _install(
        monkeypatch,
        RecordingPort(
            LaunchPaths(
                design_directory=f"{module_folder}/{PLANNING_REL}",
                design_directory_relative=PLANNING_REL,
                module_directory_name="platform--m1",
                worktree_reason="not_applicable",
            )
        ),
    )

    prompt, _design_dir, _cwd, err = await _build(task_id=None, is_planning=True)

    assert err is None
    # The layout contract belongs to Rust; Django only renders what it was
    # handed, so a promoted planning artifact lands in the right directory.
    assert "spec/platform--m1/T<sequence>--<short-task-slug>/" in prompt


# ---------------------------------------------------------------------------
# 4. Doc-chat launches — the registered root, by identity
# ---------------------------------------------------------------------------


async def test_doc_chat_runs_in_the_registered_documents_root(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    root = str(tmp_path / "wt-t1" / DESIGN_REL)
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    port = RecordingPort(
        LaunchPaths(
            working_directory=root,
            design_directory=root,
            document_relative_path="design.html",
            worktree_reason="not_applicable",
        )
    )
    _install(monkeypatch, port)

    prompt, design_dir, cwd, err = await _build(
        task_id="t1",
        is_doc_chat=True,
        doc_rel_path="stale-name.html",
        doc_id="d1",
    )

    assert err is None
    # The document is named by identity; its relative path comes back from the
    # registry rather than being trusted from the caller.
    assert port.request["document_id"] == "d1"
    assert (cwd, design_dir) == (root, root)
    assert "design.html" in prompt


async def test_doc_chat_without_an_identity_degrades_instead_of_guessing(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch, task=_task("t1"))
    port = RecordingPort()
    _install(monkeypatch, port)

    prompt, design_dir, cwd, err = await _build(
        task_id="t1",
        is_doc_chat=True,
        doc_rel_path="design.html",
        doc_id=None,
    )

    assert err is None
    # A relative path is not a lookup key at this boundary, so nothing is
    # asked and the launch degrades to the module folder.
    assert port.requests == []
    assert (cwd, design_dir) == (None, None)
    assert "design.html" in prompt


def test_prompt_text_never_names_an_unwritable_directory():
    assert prompt_builder._prompt_design_dir(LaunchPaths()) is None
    assert (
        prompt_builder._prompt_design_dir(
            LaunchPaths(
                design_directory="/tmp/x", design_directory_relative=DESIGN_REL
            )
        )
        == DESIGN_REL
    )
