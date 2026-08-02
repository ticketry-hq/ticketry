"""Fake generated per-tag SDK clients and schema-model builders."""

import json
from datetime import datetime
from uuid import UUID

from worktracker_sdk.generated import (
    AttachmentOut,
    IssueTypeOut,
    ModuleOut,
    ProjectOut,
    ScopeContextOut,
    ScopeRef,
    StateOut,
    WorkItemDetailOut,
    WorkItemOut,
)
from worktracker_sdk.generated.exceptions import ApiException
from worktracker_sdk.root_api import (
    DependencyGraphNodeOut,
    DependencyGraphOut,
    GenerateLeafLldsOut,
    GraphNodeOut,
    GraphOut,
    LaunchedAgentOut,
    LeafLldRunOut,
    PlanningRunOut,
    ReleasePlanningRunOut,
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
        self.attachments = FakeApi()
        self.execution = FakeApi()
        self.launch = FakeApi()


def raises(exc):
    def _raise(*_args, **_kwargs):
        raise exc

    return _raise


def make_api_error(status, body, error_type=ApiException):
    return error_type(status=status, body=json.dumps(body), data=body)


def make_work_item(**over) -> WorkItemOut:
    data = dict(
        id=UUID("44444444-4444-4444-4444-444444444444"),
        name="T",
        project_id=UUID("22222222-2222-2222-2222-222222222222"),
        key="MEML-1",
        issue_type=make_issue_type(),
        created_at=_TS,
        updated_at=_TS,
    )
    data.update(over)
    return WorkItemOut(**data)


def make_module(**over) -> ModuleOut:
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
    return ModuleOut(**data)


def make_project(**over) -> ProjectOut:
    data = dict(
        id=UUID("22222222-2222-2222-2222-222222222222"),
        name="Memory Lane",
        slug="meml",
        description="",
    )
    data.update(over)
    return ProjectOut(**data)


def make_state(**over) -> StateOut:
    data = dict(
        id=UUID("77777777-7777-7777-7777-777777777777"),
        name="Todo",
        group="unstarted",
    )
    data.update(over)
    return StateOut(**data)


def make_issue_type(**over) -> IssueTypeOut:
    data = dict(
        id=UUID("66666666-6666-6666-6666-666666666666"),
        name="Story",
        level="task",
        color="#222",
        sort_order=0,
    )
    data.update(over)
    return IssueTypeOut(**data)


def make_attachment(**over) -> AttachmentOut:
    data = dict(
        id=UUID("88888888-8888-8888-8888-888888888888"),
        filename="note.txt",
        mime_type="text/plain",
        size=12,
        url="http://example.test/note.txt",
    )
    data.update(over)
    return AttachmentOut(**data)


def make_detail(task=None, attachments=None) -> WorkItemDetailOut:
    return WorkItemDetailOut(
        task=task or make_work_item(),
        attachments=list(attachments or []),
    )


def make_scope_ref(**over) -> ScopeRef:
    data = dict(
        id=UUID("22222222-2222-2222-2222-222222222222"),
        key="CODIN-2",
        name="blocker",
        state_group="started",
        resolved=False,
    )
    data.update(over)
    return ScopeRef(**data)


def make_launched_agent(**over) -> LaunchedAgentOut:
    data = dict(
        target_id="44444444-4444-4444-4444-444444444444",
        agent="codex",
        agent_run_id="run-1",
    )
    data.update(over)
    return LaunchedAgentOut(**data)


def make_scope_context(**over) -> ScopeContextOut:
    ref = make_scope_ref()
    data = dict(
        task=make_scope_ref(
            id=UUID("11111111-1111-1111-1111-111111111111"),
            key="CODIN-1",
            name="T",
            state_group=None,
        ),
        depends_on=[ref],
        depended_by=[],
        advisory="1 of 1 blocker(s) unresolved.",
    )
    data.update(over)
    return ScopeContextOut(**data)


__all__ = [
    "DependencyGraphNodeOut",
    "DependencyGraphOut",
    "FakeGeneratedSdk",
    "GenerateLeafLldsOut",
    "GraphNodeOut",
    "GraphOut",
    "LaunchedAgentOut",
    "LeafLldRunOut",
    "PlanningRunOut",
    "ReleasePlanningRunOut",
    "make_api_error",
    "make_attachment",
    "make_detail",
    "make_issue_type",
    "make_launched_agent",
    "make_module",
    "make_project",
    "make_scope_context",
    "make_state",
    "make_work_item",
    "raises",
]
