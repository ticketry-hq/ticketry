"""Tests for the Session seam's ``resume`` primitive."""

from __future__ import annotations

import pytest

import apps.terminals.session as session_module
import apps.terminals.agents.registry as registry
from apps.runs.models import AgentRun
from apps.terminals.tests.fakes import FakeAdapter
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
    *,
    cwd: str,
    provider_session_id: str | None,
    ended_at: str | None = "2026-05-29T10:05:00",
) -> None:
    run = _run(cwd=cwd, provider_session_id=provider_session_id, ended_at=ended_at)
    await run.asave(force_insert=True)
    await _session().asave(force_insert=True)


def _patch_resume_adapter(monkeypatch, *, resume_fn=None, slug: str = AGENT) -> None:
    fake = FakeAdapter(slug=slug, resume_fn=resume_fn)
    monkeypatch.setitem(registry._REGISTRY, slug, fake)


def _capture_launch(monkeypatch) -> dict:
    captured: dict = {}

    async def fake_launch(**kwargs):
        captured.update(kwargs)
        return kwargs["agent_run_id"]

    monkeypatch.setattr(session_module, "_launch", fake_launch)
    return captured


async def test_resume_happy_path_uses_resume_argv_and_copies_session_fields(
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

    new_run_id = await session_module.session.resume(OLD_RUN_ID)

    assert new_run_id == captured["agent_run_id"]
    assert new_run_id != OLD_RUN_ID
    int(new_run_id, 16)
    assert seen["provider_session_id"] == PROVIDER_SESSION_ID
    assert captured["argv"] == ["claude", "--resume", PROVIDER_SESSION_ID]
    assert captured["cwd"] == str(cwd)
    assert captured["scope"] == "docchat"
    assert captured["doc_rel_path"] == "specs/notes.md"
    assert captured["resumed_from"] == OLD_RUN_ID
    assert captured["issue_id"] == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )


async def test_resume_unknown_run_raises_resume_unavailable() -> None:
    with pytest.raises(session_module.ResumeUnavailable) as excinfo:
        await session_module.session.resume("missing")

    assert excinfo.value.reason == "unknown_run"


async def test_resume_active_run_raises_resume_unavailable(
    tmp_path, monkeypatch
) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(
        cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID, ended_at=None
    )
    _patch_resume_adapter(
        monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid]
    )

    with pytest.raises(session_module.ResumeUnavailable) as excinfo:
        await session_module.session.resume(OLD_RUN_ID)

    assert excinfo.value.reason == "run_still_active"


async def test_resume_without_provider_session_id_raises_resume_unavailable(
    tmp_path, monkeypatch
) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=None)
    _patch_resume_adapter(
        monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid]
    )

    with pytest.raises(session_module.ResumeUnavailable) as excinfo:
        await session_module.session.resume(OLD_RUN_ID)

    assert excinfo.value.reason == "no_provider_session_id"


async def test_resume_with_missing_cwd_raises_resume_unavailable(
    tmp_path, monkeypatch
) -> None:
    cwd = tmp_path / "missing"
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID)
    _patch_resume_adapter(
        monkeypatch, resume_fn=lambda sid: ["claude", "--resume", sid]
    )

    with pytest.raises(session_module.ResumeUnavailable) as excinfo:
        await session_module.session.resume(OLD_RUN_ID)

    assert excinfo.value.reason == "cwd_missing"


async def test_resume_unsupported_propagates(tmp_path, monkeypatch) -> None:
    cwd = tmp_path / "repo"
    cwd.mkdir()
    await _seed_run_and_session(cwd=str(cwd), provider_session_id=PROVIDER_SESSION_ID)
    _patch_resume_adapter(monkeypatch)
    captured = _capture_launch(monkeypatch)

    with pytest.raises(registry.ResumeUnsupported):
        await session_module.session.resume(OLD_RUN_ID)

    assert captured == {}
