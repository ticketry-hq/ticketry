"""The temporary terminal executor's side of the Slice 3 effect boundary.

What matters here is what Rust is allowed to conclude from each answer. An
executor that says `absent` is giving reconciliation permission to start a
runtime, so anything it cannot prove must come back `uncertain` instead. An
executor that reports success must have produced exactly one runtime for one
durable effect, whether it created that runtime or adopted one a crash left.
"""

from __future__ import annotations

import pytest

from apps.runs.models import AgentRun
from apps.runs.write_ownership import RUST_OWNER_ENV
from apps.terminals import runs_effect_port
from apps.terminals.models import AgentTerminalSession, TerminalLaunchRequest
from apps.terminals.runtime import (
    InMemoryTerminalRuntime,
    TerminalObservationError,
    TerminalObservation,
    TerminalState,
)
from apps.terminals.tests.fakes import patch_terminal_runtime
from worktracker.tests.factories import ensure_issue


pytestmark = pytest.mark.django_db(transaction=True)

EFFECT = "e" * 32
RUN = "run-effect"


def _launch_request() -> TerminalLaunchRequest:
    issue = ensure_issue(project_id="p1", module_id="m1", task_id="t1")
    # The durable Agent Run is Rust's; here it stands for a launch that Rust
    # already prepared before this executor was asked to perform anything.
    AgentRun.objects.get_or_create(
        id=RUN,
        defaults={
            "issue_id": issue.id,
            "agent": "codex",
            "status": "running",
            "started_at": "2026-08-16T12:00:00+00:00",
            "scope": "task",
        },
    )
    return TerminalLaunchRequest.objects.create(
        effect_id=EFFECT,
        agent_run_id=RUN,
        issue_id=str(issue.id),
        project_id=str(issue.project_id),
        module_id=str(issue.module_id or issue.id),
        task_id=str(issue.id),
        agent="codex",
        scope="task",
        doc_rel_path=None,
        command="agent",
        working_directory="/tmp",
        environment={},
        created_at="2026-08-16T12:00:00+00:00",
    )


def test_readiness_is_published_only_once_ownership_is_installed(monkeypatch):
    monkeypatch.delenv(RUST_OWNER_ENV, raising=False)
    assert runs_effect_port.readiness()["ready"] is False

    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    assert runs_effect_port.readiness() == {
        "version": 1,
        "ready": True,
        "runs_owner": "rust",
        "effect_owner": "django",
        "django_runs_write_fallback": False,
    }


def test_an_unobservable_runtime_is_uncertain_rather_than_absent(monkeypatch):
    """`absent` is permission to launch. Never say it without proof."""

    runtime = patch_terminal_runtime(monkeypatch)

    def unobservable(agent_run_id):
        raise TerminalObservationError("tmux did not answer")

    monkeypatch.setattr(runtime, "inspect", unobservable)

    assert runs_effect_port.observe({"agent_run_id": RUN}) == {
        "observation": "uncertain",
        "detail": "runtime_unobservable",
    }


def test_a_missing_or_exited_runtime_is_absent(monkeypatch):
    runtime = patch_terminal_runtime(monkeypatch)
    monkeypatch.setattr(
        runtime,
        "inspect",
        lambda agent_run_id: TerminalObservation(state=TerminalState.MISSING),
    )
    assert runs_effect_port.observe({"agent_run_id": RUN})["observation"] == "absent"

    monkeypatch.setattr(
        runtime,
        "inspect",
        lambda agent_run_id: TerminalObservation(
            state=TerminalState.EXITED, exit_code=0
        ),
    )
    assert runs_effect_port.observe({"agent_run_id": RUN})["observation"] == "absent"


def test_a_live_runtime_matching_its_launch_request_is_adoptable(monkeypatch):
    _launch_request()
    runtime = patch_terminal_runtime(monkeypatch)
    monkeypatch.setattr(
        runtime,
        "inspect",
        lambda agent_run_id: TerminalObservation(state=TerminalState.RUNNING),
    )
    AgentTerminalSession.objects.create(
        agent_run_id=RUN,
        tmux_session_name=RUN,
        task_id="t",
        module_id="m",
        project_id="p",
        agent="codex",
        created_at="2026-08-16T12:00:00+00:00",
        runtime_namespace="memory",
        scope="task",
    )

    issue_id = TerminalLaunchRequest.objects.get(effect_id=EFFECT).issue_id
    assert runs_effect_port.observe(
        {"agent_run_id": RUN, "issue_id": issue_id}
    ) == {"observation": "live", "runtime_id": RUN}


def test_a_live_runtime_for_another_work_item_conflicts(monkeypatch):
    _launch_request()
    runtime = patch_terminal_runtime(monkeypatch)
    monkeypatch.setattr(
        runtime,
        "inspect",
        lambda agent_run_id: TerminalObservation(state=TerminalState.RUNNING),
    )
    AgentTerminalSession.objects.create(
        agent_run_id=RUN,
        tmux_session_name=RUN,
        task_id="t",
        module_id="m",
        project_id="p",
        agent="codex",
        created_at="2026-08-16T12:00:00+00:00",
        runtime_namespace="memory",
        scope="task",
    )

    observation = runs_effect_port.observe(
        {"agent_run_id": RUN, "issue_id": "f" * 32}
    )

    # A conflict is never adopted, overwritten, or cleaned up here.
    assert observation["observation"] == "conflicting"
    assert observation["runtime_id"] == RUN


def test_execute_creates_one_runtime_and_records_only_the_terminal_mirror(monkeypatch):
    _launch_request()
    runtime = patch_terminal_runtime(monkeypatch)

    outcome = runs_effect_port.execute({"effect_id": EFFECT, "agent_run_id": RUN})

    assert outcome == {"ok": True, "runtime_id": RUN, "adopted": False}
    assert runtime.present == {RUN}
    assert AgentTerminalSession.objects.filter(agent_run_id=RUN).exists()


def test_execute_adopts_the_runtime_a_crash_already_created(monkeypatch):
    """One durable effect never produces two terminals."""

    from apps.terminals import launch

    _launch_request()
    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(launch, "terminal_runtime", runtime)
    runs_effect_port.execute({"effect_id": EFFECT, "agent_run_id": RUN})

    repeated = runs_effect_port.execute({"effect_id": EFFECT, "agent_run_id": RUN})

    assert repeated == {"ok": True, "runtime_id": RUN, "adopted": True}
    assert runtime.inspect(RUN).state is TerminalState.RUNNING


def test_execute_without_its_launch_request_fails_without_a_blind_retry():
    outcome = runs_effect_port.execute({"effect_id": EFFECT, "agent_run_id": RUN})

    assert outcome["ok"] is False
    assert outcome["code"] == "launch_request_unavailable"
    assert outcome["retryable"] is False
    # Nothing was started, so cleanup is genuinely confirmed.
    assert outcome["cleanup_confirmed"] is True


def test_an_incomplete_claim_is_refused_before_any_runtime_work():
    assert runs_effect_port.execute({"effect_id": EFFECT})["code"] == "claim_incomplete"
    assert runs_effect_port.observe({})["observation"] == "uncertain"
