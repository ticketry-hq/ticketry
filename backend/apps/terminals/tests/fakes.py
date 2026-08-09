"""Test doubles for application launch and the public terminal runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from apps.terminals.agents.registry import LaunchAugmentation, ResumeUnsupported
from apps.terminals.runtime import (
    CreateTerminal,
    TerminalObservation,
    TerminalObservationError,
    TerminalState,
    TerminationResult,
)


@dataclass
class RecordingTerminalRuntime:
    """Small application-test fake for launch and cleanup orchestration."""

    namespace: str = "test"
    legacy_namespaces: tuple[str, ...] = ()
    create_error: Exception | None = None
    requests: list[CreateTerminal] = field(default_factory=list)
    terminated: list[str] = field(default_factory=list)
    present: set[str] = field(default_factory=set)
    exited: dict[str, int | None] = field(default_factory=dict)
    unavailable: set[str] = field(default_factory=set)

    def create(self, request: CreateTerminal) -> None:
        self.requests.append(request)
        if self.create_error is not None:
            raise self.create_error
        self.present.add(request.agent_run_id)

    def inspect(self, agent_run_id: str) -> TerminalObservation:
        if agent_run_id in self.unavailable:
            raise TerminalObservationError(agent_run_id)
        if agent_run_id in self.exited:
            return TerminalObservation(
                TerminalState.EXITED,
                self.exited[agent_run_id],
            )
        state = (
            TerminalState.RUNNING
            if agent_run_id in self.present
            else TerminalState.MISSING
        )
        return TerminalObservation(state)

    def terminate(self, agent_run_id: str) -> TerminationResult:
        self.terminated.append(agent_run_id)
        was_present = (
            agent_run_id in self.present or agent_run_id in self.exited
        )
        self.present.discard(agent_run_id)
        self.exited.pop(agent_run_id, None)
        return TerminationResult(was_present=was_present)

    def finish(self, agent_run_id: str, exit_code: int | None = None) -> None:
        self.present.discard(agent_run_id)
        self.exited[agent_run_id] = exit_code

    def fail_observation(self, agent_run_id: str) -> None:
        self.unavailable.add(agent_run_id)


def patch_terminal_runtime(monkeypatch, *, create_error: Exception | None = None):
    from apps.terminals import launch

    runtime = RecordingTerminalRuntime(create_error=create_error)
    monkeypatch.setattr(launch, "terminal_runtime", runtime)
    return runtime


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
