"""Application-service coverage for durable module shells (#666).

Everything here is asserted through the public terminal runtime protocol and
the transport-independent shell operations — never through tmux, and never
through a private launch helper.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from asgiref.sync import async_to_sync

from apps.errors import ApplicationError
from apps.execution import driver as execution_driver
from apps.runs import api as runs_api
from apps.runs import bus as runs_bus
from apps.runs.models import AgentRun
from apps.runs.run_scopes import SHELL_SCOPE
from apps.terminals import api as terminals_api
from apps.terminals import launch as terminal_launch
from apps.terminals import shell_api, shell_launch
from apps.terminals.dao.constants import SCRATCH_TASK_ID
from apps.terminals.models import AgentTerminalSession
from apps.terminals.reconciliation import TerminalReconciler
from apps.terminals.runtime import InMemoryTerminalRuntime
from apps.terminals.tests.conftest import write_profiles
from apps.terminals.tests.fakes import patch_terminal_runtime
from apps.terminals.termination_seam import agent_run_terminated
from worktracker.tests.factories import ensure_issue, fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


PROJECT_ID = "p1"
MODULE_KEY = "m1"


def _module_id() -> str:
    return fixture_issue_id(project_id=PROJECT_ID, module_id=MODULE_KEY, task_id=None)


def _link_module(tmp_config, sample_profile, path) -> str:
    """Point the selected profile's module link at ``path``."""

    module_id = _module_id()
    ensure_issue(project_id=PROJECT_ID, module_id=MODULE_KEY, task_id=None)
    write_profiles(
        tmp_config,
        [
            {
                **sample_profile,
                "module_links": [{"module_id": module_id, "path": str(path)}],
            }
        ],
        recent=0,
    )
    return module_id


@pytest.fixture
def module_folder(tmp_path):
    folder = tmp_path / "repo"
    folder.mkdir()
    return folder


@pytest.fixture
def linked_module(tmp_config, sample_profile, module_folder):
    return _link_module(tmp_config, sample_profile, module_folder)


def test_shell_launch_persists_an_agentless_module_scoped_run(
    monkeypatch, linked_module, module_folder
):
    runtime = patch_terminal_runtime(monkeypatch)

    created = shell_api.create_module_shell(module_id=linked_module)

    agent_run_id = created["agent_run_id"]
    run = AgentRun.objects.get(id=agent_run_id)
    terminal = AgentTerminalSession.objects.get(agent_run_id=agent_run_id)
    assert str(run.issue_id) == linked_module
    assert run.agent is None
    assert run.scope == SHELL_SCOPE
    assert run.cwd == str(module_folder)
    assert terminal.agent is None
    assert terminal.scope == SHELL_SCOPE
    assert terminal.task_id == SCRATCH_TASK_ID
    assert terminal.module_id == linked_module
    assert [request.agent_run_id for request in runtime.requests] == [agent_run_id]


def test_shell_hosts_a_login_shell_in_the_module_folder_with_no_agent_environment(
    monkeypatch, linked_module, module_folder
):
    monkeypatch.setenv("SHELL", "/bin/zsh")
    runtime = patch_terminal_runtime(monkeypatch)

    shell_api.create_module_shell(module_id=linked_module)

    request = runtime.requests[0]
    assert request.command.endswith("/bin/zsh -l")
    assert request.working_directory == str(module_folder)
    # A shell has no hooks, so none of the agent lifecycle environment reaches
    # it — not an empty lifecycle URL, not an MCP URL, not a hook runner.
    assert request.environment == {}


@pytest.mark.parametrize(
    "arrange, reason",
    [
        (lambda folder: None, "module_folder_unset"),
        (lambda folder: "relative/folder", "module_folder_not_absolute"),
        (lambda folder: str(folder / "gone"), "module_folder_missing"),
        (lambda folder: str(folder / "file"), "module_folder_not_a_directory"),
    ],
)
def test_shell_launch_is_refused_without_a_usable_module_folder(
    monkeypatch, tmp_config, sample_profile, module_folder, arrange, reason
):
    (module_folder / "file").write_text("not a directory")
    linked_path = arrange(module_folder)
    module_id = _link_module(tmp_config, sample_profile, linked_path or "")
    runtime = patch_terminal_runtime(monkeypatch)

    with pytest.raises(ApplicationError) as refusal:
        shell_api.create_module_shell(module_id=module_id)

    assert refusal.value.code == reason
    assert refusal.value.status == 409
    # It never falls back to the home directory, and leaves nothing behind.
    assert runtime.requests == []
    assert not AgentRun.objects.filter(scope=SHELL_SCOPE).exists()
    assert not AgentTerminalSession.objects.filter(scope=SHELL_SCOPE).exists()


def test_shell_launch_compensates_both_records_when_the_runtime_fails(
    monkeypatch, linked_module
):
    runtime = patch_terminal_runtime(
        monkeypatch, create_error=RuntimeError("no terminal server")
    )

    with pytest.raises(ApplicationError) as failure:
        shell_api.create_module_shell(module_id=linked_module)

    assert failure.value.code == "launch_unavailable"
    assert not AgentRun.objects.filter(scope=SHELL_SCOPE).exists()
    assert not AgentTerminalSession.objects.filter(scope=SHELL_SCOPE).exists()
    # The same compensation agent launch performs: the partial runtime is
    # terminated before the records are removed.
    assert runtime.terminated == [runtime.requests[0].agent_run_id]


def test_module_shells_are_listed_without_disturbing_agent_run_listings(
    monkeypatch, linked_module
):
    patch_terminal_runtime(monkeypatch)

    first = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]
    second = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]

    listed = shell_api.list_module_shells(linked_module)

    assert [entry["agent_run_id"] for entry in listed] == [first, second]
    assert all(entry["module_id"] == linked_module for entry in listed)
    # The agent-run surfaces keep their own meaning: a shell is neither a
    # scratch tab, nor a task terminal, nor a resumable conversation.
    project_id = str(AgentRun.objects.get(id=first).issue.project_id)
    assert terminals_api.list_scratch_terminals(project_id) == []
    assert terminals_api.list_terminals(SCRATCH_TASK_ID) == []
    assert terminals_api.list_resumable_terminals(None, project_id, linked_module) == []


def test_ended_shell_leaves_the_module_shell_listing(monkeypatch, linked_module):
    patch_terminal_runtime(monkeypatch)
    agent_run_id = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]

    terminals_api.terminate_terminal(agent_run_id)

    assert shell_api.list_module_shells(linked_module) == []


def test_reconciliation_records_a_shell_exit_without_an_agent_outcome(
    monkeypatch, linked_module
):
    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(terminal_launch, "terminal_runtime", runtime)
    agent_run_id = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]
    runtime.finish(agent_run_id, exit_code=130)

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id=agent_run_id)
    assert result.exited == [agent_run_id]
    assert run.exit_code == 130
    assert run.ended_at is not None
    # The ending is recorded as "the shell ended", never reinterpreted into an
    # agent identity or a provider conversation to resume.
    assert run.agent is None
    assert run.scope == SHELL_SCOPE
    assert run.provider_session_id is None
    assert shell_api.list_module_shells(linked_module) == []


def test_ending_a_shell_announces_completion_and_advances_no_campaign(
    monkeypatch, linked_module
):
    patch_terminal_runtime(monkeypatch)
    agent_run_id = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]

    announced: list[str] = []

    def record(sender, agent_run_id, **kwargs):
        announced.append(agent_run_id)

    agent_run_terminated.connect(record, dispatch_uid="test_shell_completion_seam")
    try:
        terminals_api.terminate_terminal(agent_run_id)
    finally:
        agent_run_terminated.disconnect(dispatch_uid="test_shell_completion_seam")

    assert announced == [agent_run_id]
    # The subtree scheduler resolves a terminated run to the scheduled work it
    # launched. A shell launched none, so nothing advances.
    assert execution_driver.observe_agent_run_terminated(agent_run_id=agent_run_id) == []


@pytest.mark.parametrize("exit_code", [0, 3])
def test_a_shell_exit_publishes_its_code_as_pushed_completion_state(
    monkeypatch, linked_module, exit_code
):
    """The surface learns *that* a shell ended and *how* in the same frame.

    Panel behaviour turns on the difference — a clean exit disposes the tab, a
    failure keeps it — so the code cannot be a separate read that may or may not
    have landed by the time the ending is handled (#670).
    """

    frames: list[tuple[str, dict]] = []

    async def capture(project_id: str, frame: dict) -> None:
        frames.append((project_id, frame))

    monkeypatch.setattr(runs_bus, "publish_status", capture)
    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(terminal_launch, "terminal_runtime", runtime)
    agent_run_id = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]
    runtime.finish(agent_run_id, exit_code=exit_code)
    frames.clear()

    TerminalReconciler(runtime).reconcile()

    endings = [
        frame
        for _, frame in frames
        if frame.get("type") == "backend_session"
        and frame.get("agent_run_id") == agent_run_id
    ]
    assert endings == [
        {
            "v": 1,
            "type": "backend_session",
            "agent_run_id": agent_run_id,
            "status": "exited",
            "at": endings[0]["at"],
            "exit_code": exit_code,
        }
    ]
    # The authoritative snapshot agrees with the delta, so a surface that
    # reconnects instead of hearing the frame reads the same outcome.
    project_id = str(AgentRun.objects.get(id=agent_run_id).issue.project_id)
    snapshot = async_to_sync(runs_api.agent_status)(project_id)
    record = next(
        run for run in snapshot.runs if run.agent_run_id == agent_run_id
    )
    assert record.exit_code == exit_code
    assert record.scope == SHELL_SCOPE


def test_a_reconciled_shell_exit_announces_completion_and_advances_no_campaign(
    monkeypatch, linked_module
):
    """A shell dying on its own is as inert to scheduling as one terminated.

    The explicit-termination path is covered above; this is the other way a
    shell run reaches the completion seam, and it must be just as inert.
    """

    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(terminal_launch, "terminal_runtime", runtime)
    agent_run_id = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]
    runtime.finish(agent_run_id, exit_code=1)

    announced: list[str] = []

    def record(sender, agent_run_id, **kwargs):
        announced.append(agent_run_id)

    agent_run_terminated.connect(record, dispatch_uid="test_shell_exit_seam")
    try:
        TerminalReconciler(runtime).reconcile()
    finally:
        agent_run_terminated.disconnect(dispatch_uid="test_shell_exit_seam")

    assert announced == [agent_run_id]
    assert execution_driver.observe_agent_run_terminated(agent_run_id=agent_run_id) == []


def test_restarting_a_shell_mints_a_new_run_and_never_revives_the_dead_one(
    monkeypatch, linked_module
):
    """Restart is a launch, not a resume.

    A dead durable session cannot be reattached, so the only honest restart is a
    new shell run beside the historical one — which stays ended, keeps its exit
    code, and never returns to the module's live listing (#670).
    """

    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(terminal_launch, "terminal_runtime", runtime)
    dead = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]
    runtime.finish(dead, exit_code=2)
    TerminalReconciler(runtime).reconcile()

    restarted = shell_api.create_module_shell(module_id=linked_module)["agent_run_id"]

    assert restarted != dead
    assert [entry["agent_run_id"] for entry in shell_api.list_module_shells(
        linked_module
    )] == [restarted]
    historical = AgentRun.objects.get(id=dead)
    assert historical.ended_at is not None
    assert historical.exit_code == 2
    # A further reconciliation pass does not resurrect the historical run: only
    # a runtime observed *running* may repair a tombstone, and this one is gone.
    TerminalReconciler(runtime).reconcile()
    assert AgentRun.objects.get(id=dead).ended_at == historical.ended_at


def test_shell_launch_service_depends_on_the_public_runtime_protocol():
    tree = ast.parse(Path(shell_launch.__file__).read_text(encoding="utf-8"))
    forbidden = {
        "apps.runs.models",
        "apps.terminals.models",
        "apps.terminals.tmux",
        "worktracker.models",
    }
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)

    assert not any(
        name == prefix or name.startswith(f"{prefix}.")
        for name in imported
        for prefix in forbidden
    )
    # Shell launch resolves no adapter, no prompt, no skills and no launch
    # configuration — the four things agent launch exists to decide.
    assert not any(
        name.startswith("apps.terminals.agents")
        or name in {
            "apps.terminals.prompt_builder",
            "apps.terminals.launch_configuration",
        }
        for name in imported
    )

