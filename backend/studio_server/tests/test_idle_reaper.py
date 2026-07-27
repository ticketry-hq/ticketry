from __future__ import annotations

from types import SimpleNamespace

import pytest

import studio_server.asgi as asgi


@pytest.mark.asyncio
async def test_startup_terminal_reconcile_uses_terminal_session_service(monkeypatch):
    reconciled = []

    monkeypatch.setattr(
        asgi.terminal_session,
        "reconcile",
        lambda: reconciled.append(True),
    )

    await asgi._reap_dead_terminal_sessions()

    assert reconciled == [True]


@pytest.mark.asyncio
async def test_idle_terminal_sweep_seconds_parses_and_disables(monkeypatch):
    monkeypatch.setenv("MUXED_IDLE_SWEEP_MINUTES", "15")
    assert asgi._idle_terminal_sweep_seconds() == 900.0

    monkeypatch.setenv("MUXED_IDLE_SWEEP_MINUTES", "0")
    assert asgi._idle_terminal_sweep_seconds() is None

    monkeypatch.setenv("MUXED_IDLE_SWEEP_MINUTES", "junk")
    assert asgi._idle_terminal_sweep_seconds() is None


@pytest.mark.asyncio
async def test_start_idle_terminal_sweep_creates_a_task_when_enabled(monkeypatch):
    created = {}

    class DummyTask(SimpleNamespace):
        pass

    def fake_create_task(coro):
        created["coro"] = coro
        coro.close()
        return DummyTask()

    monkeypatch.setenv("MUXED_IDLE_SWEEP_MINUTES", "15")
    monkeypatch.setattr(asgi, "_idle_terminal_reaper_task", None)
    monkeypatch.setattr(asgi.asyncio, "create_task", fake_create_task)

    await asgi._start_idle_terminal_sweep()

    assert isinstance(asgi._idle_terminal_reaper_task, DummyTask)
    assert "coro" in created


@pytest.mark.asyncio
async def test_start_idle_terminal_sweep_is_disabled_when_interval_invalid(
    monkeypatch,
):
    monkeypatch.setenv("MUXED_IDLE_SWEEP_MINUTES", "0")
    monkeypatch.setattr(asgi, "_idle_terminal_reaper_task", None)

    await asgi._start_idle_terminal_sweep()

    assert asgi._idle_terminal_reaper_task is None
