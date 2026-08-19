from __future__ import annotations

import ast
from pathlib import Path

import pytest

from apps.runs.models import AgentRun
from apps.terminals import launch, persistence, reconciliation, runs_effect_port
from apps.terminals.models import AgentTerminalSession, TerminalLaunchRequest
from apps.terminals.persistence import (
    LaunchRecords,
    PreparedCommand,
    discard_launch_request,
    launch_effect_id,
    prepare_launch,
    record_terminal_mirror,
    settle_launch,
)
from apps.terminals.reconciliation import TerminalReconciler
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
    TerminalRuntimeError,
    TerminalState,
)
from worktracker.tests.factories import ensure_issue, fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


def _records(issue_id: str) -> LaunchRecords:
    return LaunchRecords(
        agent_run_id="run-persisted",
        issue_id=issue_id,
        agent="codex",
        model="gpt-5.6",
        reasoning="high",
        started_at="2026-08-09T12:00:00+00:00",
        cwd="/tmp",
        design_dir=None,
        resumed_from=None,
        scope="task",
        doc_rel_path=None,
        runtime_namespace="memory",
    )


def test_a_prepared_launch_is_durable_before_any_runtime_exists():
    """Durable fact first: the run exists before an external effect could."""

    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")

    prepared = prepare_launch(
        _records(issue_id),
        PreparedCommand(command="agent", environment={}, columns=80, rows=24),
    )

    run = AgentRun.objects.get(id="run-persisted")
    assert str(run.issue_id) == issue_id
    assert run.lifecycle_state == "starting"
    assert (run.agent, run.model, run.reasoning) == ("codex", "gpt-5.6", "high")
    assert prepared.reused is False
    # No terminal mirror yet: nothing external has happened.
    assert not AgentTerminalSession.objects.filter(
        agent_run_id="run-persisted"
    ).exists()

    record_terminal_mirror(_records(issue_id), prepared.routing)
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-persisted")
    assert terminal.task_id == issue_id
    assert terminal.project_id == prepared.routing.project_id
    assert terminal.module_id == prepared.routing.module_id
    assert terminal.runtime_namespace == "memory"


def test_a_repeated_preparation_reuses_its_effect_instead_of_a_second_run():
    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")
    command = PreparedCommand(command="agent", environment={}, columns=80, rows=24)

    first = prepare_launch(_records(issue_id), command)
    second = prepare_launch(_records(issue_id), command)

    assert first.effect_id == second.effect_id
    assert second.reused is True
    assert AgentRun.objects.filter(id="run-persisted").count() == 1


def test_a_failure_with_confirmed_cleanup_leaves_no_launch_behind():
    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")

    prepared = prepare_launch(
        _records(issue_id),
        PreparedCommand(command="agent", environment={}, columns=80, rows=24),
    )
    settle_launch(
        prepared.effect_id,
        applied=False,
        code="terminal_runtime_unavailable",
        retryable=True,
        cleanup_confirmed=True,
    )
    discard_launch_request(prepared.effect_id)

    assert not AgentRun.objects.filter(id="run-persisted").exists()


def test_a_failure_without_proven_cleanup_keeps_a_durable_handle():
    """An unproven cleanup must not delete rows an external runtime matches."""

    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")

    prepared = prepare_launch(
        _records(issue_id),
        PreparedCommand(command="agent", environment={}, columns=80, rows=24),
    )
    settle_launch(
        prepared.effect_id,
        applied=False,
        code="terminal_runtime_unavailable",
        retryable=True,
        cleanup_confirmed=False,
    )

    assert AgentRun.objects.get(id="run-persisted").status == "cleanup_pending"


def test_a_crash_at_the_rust_boundary_leaves_only_an_inert_launch_request(monkeypatch):
    """The two writes straddle an ownership boundary; only one orphan is safe.

    A crash, sidecar restart, or transport failure between this capability's
    launch request and Rust's durable effect will sometimes leave exactly one
    of them committed. The survivable orphan is the launch request: no effect
    exists, so reconciliation never sees it and nothing can turn it into a
    failure. The fatal orphan — a prepared effect whose execution material was
    never written — must not be reachable from here.
    """

    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")

    def crash_after_the_boundary(intent, snapshot):
        raise RuntimeError("sidecar restarted mid-preparation")

    monkeypatch.setattr(
        persistence.rust_port, "prepare_launch", crash_after_the_boundary
    )

    with pytest.raises(RuntimeError):
        prepare_launch(
            _records(issue_id),
            PreparedCommand(command="agent", environment={}, columns=80, rows=24),
        )

    effect_id = launch_effect_id("run-persisted")
    assert not AgentRun.objects.filter(id="run-persisted").exists()
    request = TerminalLaunchRequest.objects.get(effect_id=effect_id)
    assert request.agent_run_id == "run-persisted"


def test_re_preparing_after_that_crash_leaves_an_executable_effect(monkeypatch):
    """The launch the crash interrupted is re-preparable, not permanently lost."""

    issue_id = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")
    command = PreparedCommand(command="agent", environment={}, columns=80, rows=24)

    durable = persistence.rust_port.prepare_launch
    crashes = {"remaining": 1}

    def crash_once_then_prepare(intent, snapshot):
        if crashes["remaining"]:
            crashes["remaining"] -= 1
            raise RuntimeError("sidecar restarted mid-preparation")
        return durable(intent, snapshot)

    monkeypatch.setattr(
        persistence.rust_port, "prepare_launch", crash_once_then_prepare
    )
    with pytest.raises(RuntimeError):
        prepare_launch(_records(issue_id), command)

    prepared = prepare_launch(_records(issue_id), command)

    # The executor Rust reaches on the next pass finds its material, so the
    # effect is executable rather than settling as `launch_request_unavailable`.
    monkeypatch.setattr(launch, "terminal_runtime", InMemoryTerminalRuntime())
    outcome = runs_effect_port.execute(
        {"effect_id": prepared.effect_id, "agent_run_id": "run-persisted"}
    )
    assert outcome == {"ok": True, "runtime_id": "run-persisted", "adopted": False}


def test_launch_service_depends_on_public_runtime_not_tmux_or_models():
    tree = ast.parse(Path(launch.__file__).read_text(encoding="utf-8"))
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
    assert "apps.terminals.runtime" in imported


def _recorded_runtime(
    run_id: str,
    *,
    namespace: str = "memory",
) -> InMemoryTerminalRuntime:
    runtime = InMemoryTerminalRuntime(namespace=namespace)
    runtime.create(
        CreateTerminal(
            agent_run_id=run_id,
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )
    return runtime


def _persist_active_run(
    run_id: str,
    *,
    exit_code: int | None = None,
    runtime_namespace: str | None = "memory",
) -> None:
    issue_id = str(
        ensure_issue(project_id="p1", module_id="m1", task_id=run_id).id
    )
    records = LaunchRecords(
        agent_run_id=run_id,
        issue_id=issue_id,
        agent="codex",
        started_at="2026-08-09T12:00:00+00:00",
        cwd="/tmp",
        design_dir=None,
        resumed_from=None,
        scope="task",
        doc_rel_path=None,
        runtime_namespace=runtime_namespace,
    )
    prepared = prepare_launch(
        records,
        PreparedCommand(command="agent", environment={}, columns=80, rows=24),
    )
    record_terminal_mirror(records, prepared.routing)
    settle_launch(prepared.effect_id, applied=True, runtime_id=run_id)
    if exit_code is not None:
        AgentRun.objects.filter(id=run_id).update(exit_code=exit_code)


def test_reconciliation_running_observation_preserves_application_liveness():
    _persist_active_run("run-running")
    runtime = _recorded_runtime("run-running")

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-running")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-running")
    assert result.running == ["run-running"]
    assert run.status == "running"
    assert run.ended_at is None
    assert terminal.terminated_at is None
    assert runtime.inspect("run-running").state is TerminalState.RUNNING


def test_reconciliation_observation_failure_preserves_application_state():
    _persist_active_run("run-unavailable")
    runtime = _recorded_runtime("run-unavailable")
    runtime.fail_observation(
        "run-unavailable",
        RuntimeError("temporary tmux failure"),
    )

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-unavailable")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-unavailable")
    assert result.unavailable == ["run-unavailable"]
    assert run.status == "running"
    assert run.ended_at is None
    assert terminal.terminated_at is None


def test_reconciliation_ignores_active_rows_owned_by_another_runtime():
    _persist_active_run("run-local", runtime_namespace="profile-a")
    _persist_active_run("run-foreign", runtime_namespace="profile-b")
    runtime = _recorded_runtime("run-local", namespace="profile-a")

    result = TerminalReconciler(runtime).reconcile()

    foreign_run = AgentRun.objects.get(id="run-foreign")
    foreign_terminal = AgentTerminalSession.objects.get(
        agent_run_id="run-foreign"
    )
    assert result.running == ["run-local"]
    assert result.soft_deleted == []
    assert foreign_run.status == "running"
    assert foreign_run.ended_at is None
    assert foreign_terminal.terminated_at is None


def test_reconciliation_leaves_missing_legacy_row_unclaimed():
    _persist_active_run("run-legacy-foreign", runtime_namespace=None)
    runtime = InMemoryTerminalRuntime(namespace="profile-a")

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-legacy-foreign")
    terminal = AgentTerminalSession.objects.get(
        agent_run_id="run-legacy-foreign"
    )
    assert result.soft_deleted == []
    assert run.status == "running"
    assert run.ended_at is None
    assert terminal.terminated_at is None
    assert terminal.runtime_namespace is None


def test_reconciliation_claims_legacy_row_visible_on_its_runtime():
    _persist_active_run("run-legacy-local", runtime_namespace=None)
    runtime = InMemoryTerminalRuntime(namespace="profile-a")
    runtime.create(
        CreateTerminal(
            agent_run_id="run-legacy-local",
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )

    result = TerminalReconciler(runtime).reconcile()

    terminal = AgentTerminalSession.objects.get(agent_run_id="run-legacy-local")
    assert result.running == ["run-legacy-local"]
    assert terminal.runtime_namespace == "profile-a"


def test_reconciliation_recovers_live_tombstone_from_legacy_runtime_identity():
    _persist_active_run("run-legacy-tombstone", runtime_namespace="socket-name")
    AgentRun.objects.filter(id="run-legacy-tombstone").update(
        status="exited",
        ended_at="2026-08-09T12:05:00+00:00",
        exit_code=0,
        lifecycle_state="exited",
        lifecycle_updated_at="2026-08-09T12:05:00+00:00",
    )
    AgentTerminalSession.objects.filter(agent_run_id="run-legacy-tombstone").update(
        terminated_at="2026-08-09T12:05:00+00:00"
    )
    runtime = InMemoryTerminalRuntime(
        namespace="tmux-endpoint-hash",
        legacy_namespaces=("socket-name",),
    )
    runtime.create(
        CreateTerminal(
            agent_run_id="run-legacy-tombstone",
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-legacy-tombstone")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-legacy-tombstone")
    assert result.recovered == ["run-legacy-tombstone"]
    assert result.running == ["run-legacy-tombstone"]
    # The terminal mirror is this capability's own row and is repaired. The
    # Agent Run is not: an explicit terminal outcome is terminal authority
    # under the Runs contract, so a run that ended stays ended rather than
    # being presented as active again.
    assert terminal.terminated_at is None
    assert terminal.runtime_namespace == "tmux-endpoint-hash"
    assert run.ended_at == "2026-08-09T12:05:00+00:00"
    assert run.lifecycle_state == "exited"


def test_reconciliation_recovers_live_tombstone_from_current_runtime_identity():
    _persist_active_run("run-current-tombstone", runtime_namespace="profile-a")
    AgentRun.objects.filter(id="run-current-tombstone").update(
        status="exited",
        ended_at="2026-08-09T12:05:00+00:00",
        lifecycle_state="exited",
        lifecycle_updated_at="2026-08-09T12:05:00+00:00",
    )
    AgentTerminalSession.objects.filter(agent_run_id="run-current-tombstone").update(
        terminated_at="2026-08-09T12:05:00+00:00"
    )
    runtime = InMemoryTerminalRuntime(namespace="profile-a")
    runtime.create(
        CreateTerminal(
            agent_run_id="run-current-tombstone",
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )
    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-current-tombstone")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-current-tombstone")
    assert result.recovered == ["run-current-tombstone"]
    assert result.running == ["run-current-tombstone"]
    assert terminal.terminated_at is None
    assert terminal.runtime_namespace == "profile-a"
    # The ended Agent Run is untouched: a dead session must never be presented
    # as active again, and only the Runs owner may say a run ended.
    assert run.ended_at == "2026-08-09T12:05:00+00:00"
    assert run.lifecycle_state == "exited"


def test_reconciliation_persists_exit_code_before_retained_runtime_cleanup():
    _persist_active_run("run-exited")

    class OrderingRuntime(InMemoryTerminalRuntime):
        def terminate(self, agent_run_id: str):
            run = AgentRun.objects.get(id=agent_run_id)
            terminal = AgentTerminalSession.objects.get(agent_run_id=agent_run_id)
            assert run.ended_at is not None
            assert run.exit_code == 17
            assert terminal.terminated_at is not None
            return super().terminate(agent_run_id)

    runtime = OrderingRuntime()
    runtime.create(
        CreateTerminal(
            agent_run_id="run-exited",
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )
    runtime.finish("run-exited", exit_code=17)

    result = TerminalReconciler(runtime).reconcile()

    assert result.exited == ["run-exited"]
    assert runtime.inspect("run-exited").state is TerminalState.MISSING


def test_reconciliation_retries_retained_runtime_cleanup_after_classification():
    _persist_active_run("run-cleanup-retry")

    class RetryCleanupRuntime(InMemoryTerminalRuntime):
        def __init__(self):
            super().__init__()
            self.terminate_attempts = 0

        def terminate(self, agent_run_id: str):
            self.terminate_attempts += 1
            if self.terminate_attempts == 1:
                raise TerminalRuntimeError("temporary tmux failure")
            return super().terminate(agent_run_id)

    runtime = RetryCleanupRuntime()
    runtime.create(
        CreateTerminal(
            agent_run_id="run-cleanup-retry",
            command="agent",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )
    runtime.finish("run-cleanup-retry", exit_code=31)

    first_result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-cleanup-retry")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-cleanup-retry")
    assert first_result.exited == ["run-cleanup-retry"]
    assert run.exit_code == 31
    assert run.ended_at is not None
    assert terminal.terminated_at is not None
    assert terminal.runtime_cleanup_pending is True

    second_result = TerminalReconciler(runtime).reconcile()

    terminal.refresh_from_db()
    assert second_result.exited == []
    assert runtime.terminate_attempts == 2
    assert runtime.inspect("run-cleanup-retry").state is TerminalState.MISSING
    assert terminal.runtime_cleanup_pending is False

    TerminalReconciler(runtime).reconcile()
    assert runtime.terminate_attempts == 2


def test_reconciliation_missing_runtime_records_disappearance_without_exit_code():
    _persist_active_run("run-missing", exit_code=23)
    runtime = InMemoryTerminalRuntime()

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-missing")
    assert result.soft_deleted == ["run-missing"]
    # A runtime that simply vanished is `lost`, not a clean exit, and it
    # supplies no exit code — so a previously recorded process result stands.
    assert run.status == "lost"
    assert run.exit_code == 23


def test_reconciliation_persistence_failure_retains_exit_for_retry(monkeypatch):
    _persist_active_run("run-retry")
    runtime = _recorded_runtime("run-retry")
    runtime.finish("run-retry", exit_code=9)

    def fail_persistence(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        reconciliation,
        "persist_reconciliation_outcome",
        fail_persistence,
    )

    result = TerminalReconciler(runtime).reconcile()

    run = AgentRun.objects.get(id="run-retry")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-retry")
    assert result.persistence_failed == ["run-retry"]
    assert run.status == "running"
    assert run.ended_at is None
    assert terminal.terminated_at is None
    observation = runtime.inspect("run-retry")
    assert observation.state is TerminalState.EXITED
    assert observation.exit_code == 9


def test_reconciliation_service_depends_on_public_runtime_not_tmux():
    tree = ast.parse(Path(reconciliation.__file__).read_text(encoding="utf-8"))
    imported = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert "apps.terminals.runtime" in imported
    assert not any(name.startswith("apps.terminals.tmux") for name in imported)
