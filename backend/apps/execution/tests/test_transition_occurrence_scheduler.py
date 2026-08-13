from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_scheduler_drains_on_startup_and_periodically(monkeypatch):
    from apps.execution import transition_occurrence_scheduler as scheduler

    drains: list[int] = []
    monkeypatch.setattr(
        scheduler,
        "reconcile_pending_occurrences",
        lambda: drains.append(len(drains)),
    )
    monkeypatch.setenv("MUXED_TRANSITION_RECONCILE_SECONDS", "0.01")

    await scheduler.start()
    await asyncio.sleep(0.035)
    await scheduler.stop()

    assert len(drains) >= 2
