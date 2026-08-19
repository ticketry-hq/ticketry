"""Tests for the agent-launch application's provider-resume operation."""

from __future__ import annotations

import pytest

from apps.runs.tests.seeding import aseed_agent_run
from asgiref.sync import async_to_sync

import apps.runs.dao as runs_dao
import apps.terminals.dao as terminals_dao
import apps.terminals.launch as launch_module
import apps.terminals.agents.registry as registry
from apps.runs.models import AgentRun
from apps.runs.run_scopes import SHELL_SCOPE
from apps.terminals.tests.fakes import FakeAdapter, patch_terminal_runtime
from apps.terminals.models import AgentTerminalSession
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)

AGENT = "claude"
PROJECT_ID = "p1"
MODULE_ID = "m1"
TASK_ID = "t1"
OLD_RUN_ID = "old-run"
PROVIDER_SESSION_ID = "sess-123"


def _run(
    run_id: str = OLD_RUN_ID,
    *,
    ended_at: str | None,
    provider_session_id: str | None,
    cwd: str,
) -> AgentRun:
    return AgentRun(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
        ),
        agent=AGENT,
        status="terminated" if ended_at is not None else "running",
        started_at="2026-05-29T10:00:00",
        ended_at=ended_at,
        cwd=cwd,
        provider_session_id=provider_session_id,
        design_dir="/repo/design",
        launch_state="Grill",
        launch_model="sonnet",
        scope="docchat",
    )


def _session(
    run_id: str = OLD_RUN_ID,
    *,
    created_at: str = "2026-05-29T10:05:00",
    terminated_at: str | None = "2026-05-29T10:10:00",
    scope: str = "docchat",
    doc_rel_path: str | None = "specs/notes.md",
) -> AgentTerminalSession:
    return AgentTerminalSession(
        agent_run_id=run_id,
        tmux_session_name=f"pt-{run_id}",
        task_id=TASK_ID,
        module_id=MODULE_ID,
        project_id=PROJECT_ID,
        agent=AGENT,
        created_at=created_at,
        terminated_at=terminated_at,
        scope=scope,
        doc_rel_path=doc_rel_path,
    )


async def _seed_run_and_session(
    *, cwd: str, provider_session_id: str | None, ended_at: str | None = "2026-05-29T10:05:00"
) -> None:
    await aseed_agent_run(
        _run(cwd=cwd, provider_session_id=provider_session_id, ended_at=ended_at)
    )
    await terminals_dao.insert_terminal_session(_session())


def _patch_resume_adapter(monkeypatch, *, resume_fn=None, slug: str = AGENT) -> None:
    fake = FakeAdapter(slug=slug, resume_fn=resume_fn)
    monkeypatch.setitem(registry._REGISTRY, slug, fake)


def _capture_launch(monkeypatch) -> dict:
    captured: dict = {}

    async def fake_launch(**kwargs):
        captured.update(kwargs)
        return kwargs["agent_run_id"]

    monkeypatch.setattr(launch_module, "_launch", fake_launch)
    return captured


async def test_resume_happy_path_prepares_provider_command_without_old_terminal(
    tmp_path, monkeypatch
):
    cwd = tmp_path / "repo"
    cwd.mkdir()
    seen: dict = {}

    def resume_fn(provider_session_id: str) -> list[str]:
        seen["provider_session_id"] = provider_session_id
        return ["claude", "--resume", provider_session_id]

    await _seed_run_and_session(cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID)
    _patch_resume_adapter(monkeypatch, resume_fn=resume_fn)
    captured = _capture_launch(monkeypatch)

    new_run_id = await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert new_run_id == captured["agent_run_id"]
    assert new_run_id != OLD_RUN_ID
    int(new_run_id, 16)
    assert seen["provider_session_id"] == PROVIDER_SESSION_ID
    assert captured["argv"] == ["claude", "--resume", PROVIDER_SESSION_ID]
    assert captured["cwd"] == str(cwd)
    assert captured["scope"] == "docchat"
    assert captured["doc_rel_path"] is None
    assert captured["provider_session_id"] == PROVIDER_SESSION_ID
    assert "resumed_from" not in captured
    assert captured["issue_id"] == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )


def test_resume_persists_fresh_run_and_terminal_with_provider_continuity(
    tmp_path, monkeypatch
):
    cwd = tmp_path / "repo"
    cwd.mkdir()
    old_run = _run(
        cwd=str(cwd),
        provider_session_id=PROVIDER_SESSION_ID,
        ended_at="2026-05-29T10:05:00",
    )
    old_run.save(force_insert=True)
    old_session = _session()
    old_session.save(force_insert=True)
    _patch_resume_adapter(
        monkeypatch,
        resume_fn=lambda sid: ["claude", "--resume", sid],
    )
    runtime = patch_terminal_runtime(monkeypatch)

    new_run_id = async_to_sync(launch_module.resume_provider_conversation)(
        OLD_RUN_ID
    )

    historical = AgentRun.objects.get(id=OLD_RUN_ID)
    resumed = AgentRun.objects.get(id=new_run_id)
    new_session = AgentTerminalSession.objects.get(agent_run_id=new_run_id)
    assert historical.ended_at == "2026-05-29T10:05:00"
    assert historical.provider_session_id == PROVIDER_SESSION_ID
    assert AgentTerminalSession.objects.get(
        agent_run_id=OLD_RUN_ID
    ).terminated_at == old_session.terminated_at
    assert resumed.id != historical.id
    assert resumed.ended_at is None
    assert resumed.lifecycle_state == "starting"
    assert resumed.provider_session_id == PROVIDER_SESSION_ID
    assert resumed.resumed_from is None
    # A resume continues one conversation, so it reports the state and model
    # that conversation began in rather than re-reading current policy (#693).
    assert (resumed.launch_state, resumed.launch_model) == ("Grill", "sonnet")
    assert (historical.launch_state, historical.launch_model) == ("Grill", "sonnet")
    assert new_session.agent_run_id == new_run_id
    assert new_session.tmux_session_name != old_session.tmux_session_name
    assert len(runtime.requests) == 1
    request = runtime.requests[0]
    assert request.agent_run_id == new_run_id
    assert OLD_RUN_ID not in request.command
    assert PROVIDER_SESSION_ID in request.command


async def test_resume_unknown_run_raises_resume_unavailable() -> None:
    with pytest.raises(launch_module.ResumeUnavailable) as excinfo:
        await launch_module.resume_provider_conversation("missing")

    assert excinfo.value.reason == "unknown_run"


async def test_resume_active_run_raises_resume_unavailable(tmp_path, monkeypatch) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(
        cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID, ended_at=None
    )
    _patch_resume_adapter(monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid])

    with pytest.raises(launch_module.ResumeUnavailable) as excinfo:
        await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert excinfo.value.reason == "run_still_active"


async def test_resume_without_provider_session_id_raises_resume_unavailable(
    tmp_path, monkeypatch
) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=None)
    _patch_resume_adapter(monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid])

    with pytest.raises(launch_module.ResumeUnavailable) as excinfo:
        await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert excinfo.value.reason == "no_provider_session_id"


async def test_resume_with_missing_cwd_raises_resume_unavailable(tmp_path, monkeypatch) -> None:
    cwd = tmp_path / "missing"
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID)
    _patch_resume_adapter(monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid])

    with pytest.raises(launch_module.ResumeUnavailable) as excinfo:
        await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert excinfo.value.reason == "cwd_missing"


async def test_resume_unsupported_propagates(tmp_path, monkeypatch) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID)
    _patch_resume_adapter(monkeypatch)
    captured = _capture_launch(monkeypatch)

    with pytest.raises(registry.ResumeUnsupported):
        await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert captured == {}


async def test_resume_of_an_agentless_run_is_refused_on_its_own_terms(
    tmp_path, monkeypatch
) -> None:
    """A run with no provider has no conversation to continue (#665).

    It is refused for the absent agent rather than incidentally, so widening
    the provider-session rules can never make a shell run resumable.
    """

    cwd = tmp_path / "repo"
    cwd.mkdir()
    run = _run(
        cwd=str(cwd),
        provider_session_id=PROVIDER_SESSION_ID,
        ended_at="2026-05-29T10:05:00",
    )
    run.agent = None
    run.scope = SHELL_SCOPE
    await runs_dao.insert_agent_run(run)
    await terminals_dao.insert_terminal_session(_session(scope=SHELL_SCOPE))
    _patch_resume_adapter(monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid])

    with pytest.raises(launch_module.ResumeUnavailable) as excinfo:
        await launch_module.resume_provider_conversation(OLD_RUN_ID)

    assert excinfo.value.reason == "run_has_no_agent"
