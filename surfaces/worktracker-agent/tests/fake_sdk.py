"""Fake generated per-tag SDK clients and schema-model builders."""

import json
from datetime import datetime
from types import SimpleNamespace
from uuid import UUID

from worktracker_sdk.generated.exceptions import ApiException
from worktracker_sdk.root_api import (
    DependencyGraphNodeOut,
    DependencyGraphOut,
    ExecuteGraphOut,
    LaunchedAgentOut,
    ResetGraphOut,
    RunNowOut,
)


_TS = datetime(2026, 1, 1, 0, 0, 0)


class FakeApi:
    """Record generated operation calls and return per-operation canned values."""

    def __init__(self):
        self.returns = {}
        self.calls = []

    def _make(self, name):
        def method(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            value = self.returns.get(name)
            return value(*args, **kwargs) if callable(value) else value

        return method

    def __getattr__(self, name):
        if name in ("returns", "calls"):
            raise AttributeError(name)
        return self._make(name)


class FakeGeneratedSdk:
    """Structural fake of ``GeneratedSdk`` using generated operation names."""

    def __init__(self):
        self.api_client = FakeApi()
        self.projects = FakeApi()
        self.modules = FakeApi()
        self.issue_types = FakeApi()
        self.states = FakeApi()
        self.work_items = FakeApi()
        self.workflows = FakeApi()
        self.launch_bindings = FakeApi()
        self.models = FakeApi()
        self.providers = FakeApi()
        self.reasoning_levels = FakeApi()
        self.attachments = FakeApi()
        self.execution = FakeApi()
        self.launch = FakeApi()
        self.revisioned_delete = FakeApi()


def raises(exc):
    def _raise(*_args, **_kwargs):
        raise exc

    return _raise


def make_api_error(status, body, error_type=ApiException):
    return error_type(status=status, body=json.dumps(body), data=body)


def make_work_item(**over):
    data = dict(
        id=UUID("44444444-4444-4444-4444-444444444444"),
        name="T",
        project_id=UUID("22222222-2222-2222-2222-222222222222"),
        key="MEML-1",
        issue_type=make_issue_type(),
        state=None,
        description="",
        sequence_id=1,
        parent_id=None,
        is_archived=False,
        blocked_by_ids=[],
        blocks_ids=[],
        created_at=_TS,
        updated_at=_TS,
    )
    data.update(over)
    for field in ("id", "project_id", "parent_id"):
        if data.get(field) is not None and not isinstance(data[field], UUID):
            data[field] = UUID(data[field])
    data["blocked_by_ids"] = [UUID(str(item)) for item in data["blocked_by_ids"]]
    data["blocks_ids"] = [UUID(str(item)) for item in data["blocks_ids"]]
    return SimpleNamespace(**data)


def make_flat_work_item(**over):
    """Build the post-CODING-156 bare-id work-item SDK shape."""

    data = dict(
        id=UUID("44444444-4444-4444-4444-444444444444"),
        name="T",
        project_id=UUID("22222222-2222-2222-2222-222222222222"),
        key="MEML-1",
        issue_type=UUID("66666666-6666-6666-6666-666666666666"),
        state=None,
        description="",
        sequence_id=1,
        parent_id=None,
        is_archived=False,
        blocked_by_ids=[],
        blocks_ids=[],
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_flat_module(**over):
    data = dict(
        id=UUID("33333333-3333-3333-3333-333333333333"),
        name="M",
        project_id=UUID("22222222-2222-2222-2222-222222222222"),
        sequence_id=1,
        is_archived=False,
        key="MEML-1",
        issue_type=UUID("66666666-6666-6666-6666-666666666666"),
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_module(**over):
    data = dict(
        id=UUID("33333333-3333-3333-3333-333333333333"),
        name="M",
        project_id=UUID("22222222-2222-2222-2222-222222222222"),
        sequence_id=1,
        is_archived=False,
        key="MEML-1",
        issue_type=make_issue_type(level="module", name="Epic"),
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_project(**over):
    data = dict(
        id=UUID("22222222-2222-2222-2222-222222222222"),
        name="Memory Lane",
        slug="meml",
        description="",
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_state(**over):
    data = dict(
        id=UUID("77777777-7777-7777-7777-777777777777"),
        name="Todo",
        group="unstarted",
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_issue_type(**over):
    data = dict(
        id=UUID("66666666-6666-6666-6666-666666666666"),
        name="Story",
        level="task",
        color="#222",
        sort_order=0,
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_attachment(**over):
    data = dict(
        id=UUID("88888888-8888-8888-8888-888888888888"),
        filename="note.txt",
        mime_type="text/plain",
        size=12,
        url="http://example.test/note.txt",
    )
    data.update(over)
    return SimpleNamespace(**data)


def make_detail(task=None, attachments=None):
    return SimpleNamespace(
        task=task or make_work_item(),
        attachments=list(attachments or []),
    )


def make_launched_agent(**over) -> LaunchedAgentOut:
    data = dict(
        target_id="44444444-4444-4444-4444-444444444444",
        agent="codex",
        agent_run_id="run-1",
    )
    data.update(over)
    return LaunchedAgentOut(**data)


def make_run_now(**over) -> RunNowOut:
    data = dict(
        target_id="44444444-4444-4444-4444-444444444444",
        committed_state={
            "id": "77777777-7777-7777-7777-777777777777",
            "name": "Implement",
        },
        run=make_launched_agent(),
    )
    data.update(over)
    return RunNowOut(**data)


__all__ = [
    "DependencyGraphNodeOut",
    "DependencyGraphOut",
    "ExecuteGraphOut",
    "FakeGeneratedSdk",
    "LaunchedAgentOut",
    "ResetGraphOut",
    "make_api_error",
    "make_attachment",
    "make_detail",
    "make_issue_type",
    "make_flat_module",
    "make_flat_work_item",
    "make_launched_agent",
    "make_module",
    "make_project",
    "make_run_now",
    "make_state",
    "make_work_item",
    "raises",
]
