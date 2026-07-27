from __future__ import annotations

import logging

from apps.execution import signals
from worktracker.signals import issue_state_changed


def test_receiver_delegates_completion(monkeypatch):
    seen = {}

    def observe(*, issue_id, from_group, to_group, to_state_id=None):
        seen["issue_id"] = issue_id
        seen["from_group"] = from_group
        seen["to_group"] = to_group
        seen["to_state_id"] = to_state_id

    monkeypatch.setattr(signals.driver, "observe_issue_state_changed", observe)

    issue_state_changed.send(
        sender=object,
        issue_id="task-1",
        from_group="unstarted",
        to_group="unstarted",
        to_state_id="state-any",
    )

    assert seen == {
        "issue_id": "task-1",
        "from_group": "unstarted",
        "to_group": "unstarted",
        "to_state_id": "state-any",
    }


def test_receiver_swallows_observer_errors(monkeypatch, caplog):
    def fail(*, issue_id, from_group, to_group, to_state_id=None):
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
