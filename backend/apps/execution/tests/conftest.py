"""Execution-app test guards.

These tests run with ``transaction=True``, so the worktracker
``issue_state_changed`` seam really fires on every ``Issue.save()`` — and the
driver's launch path defaults to the real ``spawn_run``, which starts a real
tmux session. Block it for every test in this app; tests inject their own
spawn stubs explicitly.
"""

from __future__ import annotations

import pytest

from apps.execution import driver


@pytest.fixture(autouse=True)
def _block_real_spawn(monkeypatch):
    async def _blocked(**kwargs):
        raise RuntimeError("real spawn_run blocked in execution tests")

    monkeypatch.setattr(driver, "spawn_run", _blocked)
