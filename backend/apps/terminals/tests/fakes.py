"""In-memory TerminalSessionService test adapter."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Callable, Optional

from apps.terminals.session import LaunchIntent, SessionNotFound
from apps.terminals.agents.registry import LaunchAugmentation, ResumeUnsupported


@dataclass
class FakeAdapter:
    """Test double for :class:`apps.terminals.agents.registry.AgentAdapter`.

    Bind it over an existing slug with
    ``monkeypatch.setitem(registry._REGISTRY, slug, FakeAdapter(slug=slug))``
    to spawn a deterministic process without touching a real agent CLI.
    ``command`` returns a configurable argv (defaults to
    ``[slug, "--prompt", prompt]``); ``inject`` returns the argv unchanged but
    records each call, so a test can assert injection was routed through the
    registry.
    """

    slug: str
    command_fn: Optional[Callable[[str], list[str]]] = None
    resume_fn: Optional[Callable[[str], list[str]]] = None
    supports_worktracker_mcp: bool = True
    inject_calls: list = field(default_factory=list)

    def command(
        self,
        prompt: str,
        *,
        model: str | None = None,
        reasoning: str | None = None,
        activated_providers=None,
    ) -> list[str]:
        # ``activated_providers`` mirrors the real adapter's signature: the
        # launch path passes the set it read off-thread. A fake never gates.
        del activated_providers
        if self.command_fn is not None:
            return self.command_fn(prompt)
        options = []
        if model is not None:
            options.extend(["--model", model])
        if reasoning is not None:
            options.extend(["--reasoning", reasoning])
        return [self.slug, *options, "--prompt", prompt]

    def inject(
        self,
        argv: list[str],
        agent_run_id: str,
        *,
        lifecycle_url: str,
        mcp_url: str,
    ) -> list[str]:
        self.inject_calls.append((list(argv), agent_run_id, lifecycle_url, mcp_url))
        return argv

    def augment_launch(
        self,
        argv: list[str],
        agent_run_id: str,
        *,
        lifecycle_url: str,
        mcp_url: str,
        skills,
    ) -> LaunchAugmentation:
        del skills
        return LaunchAugmentation(
            tuple(
                self.inject(
                    argv,
                    agent_run_id,
                    lifecycle_url=lifecycle_url,
                    mcp_url=mcp_url,
                )
            )
        )

    @property
    def available_worktracker_tools(self) -> frozenset[str]:
        from apps.terminals.agents.skills.preflight import WORKTRACKER_TOOLS

        return WORKTRACKER_TOOLS if self.supports_worktracker_mcp else frozenset()

    supports_required_skills: bool = True

    @property
    def supports_resume(self) -> bool:
        return self.resume_fn is not None

    def resume_command(self, provider_session_id: str) -> list[str]:
        if not isinstance(provider_session_id, str) or not provider_session_id:
            raise ValueError("provider_session_id must be a non-empty str")
        if self.resume_fn is None:
            raise ResumeUnsupported(self.slug)
        return self.resume_fn(provider_session_id)


@dataclass
class _FakeHandle:
    service: "InMemorySessionService"
    agent_run_id: str
    viewer_id: str
    _released: bool = False

    def attach_argv(self) -> list[str]:
        return ["fake-attach", self.agent_run_id]

    def scroll(self, direction: str, lines: int = 3) -> None:
        self.service.scrolls.append((self.agent_run_id, direction, lines))

    def resize(self, cols: int, rows: int) -> None:
        self.service.resizes.append((self.agent_run_id, cols, rows))

    refresh_client_size = resize

    def activate(self, session: Any) -> Any | None:
        previous_session = self.service.viewer_sessions.get(self.agent_run_id)
        self.service.viewers[self.agent_run_id] = self.viewer_id
        self.service.viewer_sessions[self.agent_run_id] = session
        return previous_session

    def release(self) -> None:
        if self._released:
            return
        if self.service.viewers.get(self.agent_run_id) == self.viewer_id:
            self.service.viewers.pop(self.agent_run_id, None)
            self.service.viewer_sessions.pop(self.agent_run_id, None)
        self._released = True

    def __enter__(self) -> "_FakeHandle":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()


class InMemorySessionService:
    def __init__(self) -> None:
        self._ids = itertools.count(1)
        self.runs: dict[str, SimpleNamespace] = {}
        self.sessions: dict[str, SimpleNamespace] = {}
        self.viewers: dict[str, str] = {}
        self.viewer_sessions: dict[str, Any] = {}
        self.stopped_watchers: list[str] = []
        self.scrolls: list[tuple[str, str, int]] = []
        self.resizes: list[tuple[str, int, int]] = []

    async def spawn(self, intent: LaunchIntent) -> str:
        run_id = f"run-{next(self._ids)}"
        run = SimpleNamespace(
            id=run_id,
            agent=intent.agent,
            project_id=intent.project_id,
            module_id=intent.module_id,
            task_id=intent.task_id,
            status="running",
            ended_at=None,
        )
        session = SimpleNamespace(
            agent_run_id=run_id,
            tmux_session_name=f"pt-{run_id}",
            task_id=intent.task_id,
            module_id=intent.module_id,
            project_id=intent.project_id,
            agent=intent.agent,
            scope=intent.scope,
            doc_rel_path=intent.doc_rel_path,
            created_at="now",
            terminated_at=None,
        )
        self.runs[run_id] = run
        self.sessions[run_id] = session
        return run_id

    def terminate(self, agent_run_id: str) -> None:
        run = self.runs.get(agent_run_id)
        session = self.sessions.get(agent_run_id)
        active = (
            run is not None and run.ended_at is None
        ) or (
            session is not None and session.terminated_at is None
        )
        if not active:
            return
        if run is not None and run.ended_at is None:
            run.status = "terminated"
            run.ended_at = "now"
        if session is not None and session.terminated_at is None:
            session.terminated_at = "now"
        self.stopped_watchers.append(agent_run_id)

    def sessions_for(self, task_id: str):
        return [
            session
            for session in self.sessions.values()
            if session.task_id == task_id and session.terminated_at is None
        ]

    def attach(self, agent_run_id: str, *, viewer_id: str | None = None) -> _FakeHandle:
        if agent_run_id not in self.sessions:
            raise SessionNotFound(agent_run_id)
        viewer_id = viewer_id or f"viewer-{next(self._ids)}"
        return _FakeHandle(self, agent_run_id, viewer_id)

    def reconcile(self):
        reaped = [
            run_id
            for run_id, session in self.sessions.items()
            if getattr(session, "dead", False) and session.terminated_at is None
        ]
        for run_id in reaped:
            self.sessions[run_id].terminated_at = "now"
            run = self.runs.get(run_id)
            if run is not None and run.ended_at is None:
                run.status = "exited"
                run.ended_at = "now"
            self.stopped_watchers.append(run_id)
        return SimpleNamespace(
            soft_deleted=reaped,
            untracked=[],
            inventory_available=True,
        )
