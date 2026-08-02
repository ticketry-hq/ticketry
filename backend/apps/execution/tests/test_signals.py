from __future__ import annotations

import logging

from apps.execution import signals
from worktracker.signals import issue_state_changed


def test_receiver_delegates_completion(monkeypatch):
    seen = {}

    def observe(*, issue_id):
        seen["issue_id"] = issue_id

    monkeypatch.setattr(signals.driver, "observe_issue_state_changed", observe)

    issue_state_changed.send(
        sender=object,
        issue_id="task-1",
        from_group="unstarted",
        to_group="unstarted",
        to_state_id="state-any",
    )

    assert seen == {"issue_id": "task-1"}


def test_receiver_swallows_observer_errors(monkeypatch, caplog):
    def fail(*, issue_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(signals.driver, "observe_issue_state_changed", fail)

    with caplog.at_level(logging.ERROR):
        signals.observe_completion(
            sender=object,
            issue_id="task-1",
            from_group="started",
            to_group="completed",
        )

    assert "execution observer failed issue=task-1" in caplog.text
