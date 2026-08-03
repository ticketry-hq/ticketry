"""One door per agent for command construction and lifecycle/MCP injection.

An :class:`AgentAdapter` owns both halves behind a single slug lookup. The
launch path selects one adapter, carries that exact adapter through executable
approval, and calls its provider-specific ``command`` / ``inject`` methods.
Provider injectors therefore transform their input directly; they do not
repeat agent routing by inspecting ``argv[0]``.

Recorded decisions:

- **Workflow-capable providers get WorkTracker MCP.** Claude, Codex, Agy, and
  Gemini all receive a run-authorized WorkTracker server. This is required by
  the pinned ``to-spec`` and ``to-tickets`` skills.
- **Resume argv mirrors launch argv.** Each adapter now also builds a
  provider-native resume argv from a session id; the interactive launcher
  still injects hooks after the adapter builds that argv. agy resumes via
  ``--conversation`` because its hook captures ``conversationId`` as the
  provider session id.
- **Callers resolve URLs; adapters stay env-free.** :meth:`inject` takes
  ``lifecycle_url`` and ``mcp_url`` as required keyword arguments with no
  defaults. ``terminals.launch`` remains the single place that reads the
  environment (``WORKTRACKER_MCP_URL``) and picks the ingress URL; adapters
  never touch ``os.environ``.
- **Test seam.** Override an adapter for one test with
  ``monkeypatch.setitem(registry._REGISTRY, slug, fake)`` (see
  :class:`apps.terminals.tests.fakes.FakeAdapter`). Fakes must *replace* an existing
  slug, never add a new one — ``validation.VALID_AGENTS`` is an import-time
  snapshot of :func:`all_slugs`.
"""

from __future__ import annotations

import re
import shutil
import tempfile
from collections.abc import Set
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from worktracker.launch_capabilities import PROVIDER_CAPABILITIES
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    validate_provider_options,
)

from apps.terminals.launch_configuration import LaunchConfigurationError

from apps.terminals.agents.injectors.agy import inject_agy_lifecycle_settings
from apps.terminals.agents.injectors.claude import (
    inject_claude_lifecycle_settings,
)
from apps.terminals.agents.injectors.codex import (
    inject_codex_lifecycle_settings,
)
from apps.terminals.agents.injectors.gemini import inject_gemini_lifecycle_settings
from apps.terminals.agents.skills.preflight import (
    ResolvedSkills,
    WORKTRACKER_TOOLS,
)


class UnknownAgent(Exception):
    """No adapter is registered for the requested agent slug."""


class ResumeUnsupported(Exception):
    """No resume builder registered for this agent."""


@dataclass(frozen=True)
class LaunchAugmentation:
    """One provider's complete, invocation-scoped launch transformation."""

    argv: tuple[str, ...]
    environment: tuple[tuple[str, str], ...] = ()
    temporary_artifacts: tuple[Path, ...] = ()


def _artifact_root(agent_run_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", agent_run_id):
        raise ValueError("agent_run_id is unsafe for a temporary artifact path")
    parent = Path(tempfile.gettempdir()) / "ticketry-agent-runs"
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    run_root = parent / agent_run_id
    run_root.mkdir(mode=0o700, exist_ok=True)
    run_root.chmod(0o700)
    root = Path(tempfile.mkdtemp(prefix="invocation-", dir=run_root))
    root.chmod(0o700)
    return root


def cleanup_temporary_artifacts(paths: tuple[Path, ...]) -> None:
    """Remove only run-scoped paths returned by an adapter."""

    allowed_parent = (Path(tempfile.gettempdir()) / "ticketry-agent-runs").resolve()
    for path in paths:
        resolved = path.resolve()
        if resolved.parent.parent != allowed_parent:
            continue
        shutil.rmtree(resolved, ignore_errors=True)
        try:
            resolved.parent.rmdir()
        except OSError:
            pass


def cleanup_temporary_artifacts_for_run(agent_run_id: str) -> None:
    """Remove the narrowly named temp root owned by one run id."""

    parent = Path(tempfile.gettempdir()) / "ticketry-agent-runs"
    run_root = (parent / agent_run_id).resolve()
    if run_root.parent != parent.resolve():
        return
    shutil.rmtree(run_root, ignore_errors=True)


def reconcile_temporary_artifacts(active_agent_run_ids: Set[str]) -> None:
    """Remove run overlays that no active terminal metadata still owns."""

    parent = Path(tempfile.gettempdir()) / "ticketry-agent-runs"
    if not parent.is_dir():
        return
    active = set(active_agent_run_ids)
    for run_root in parent.iterdir():
        if run_root.is_dir() and run_root.name not in active:
            cleanup_temporary_artifacts_for_run(run_root.name)
    try:
        parent.rmdir()
    except OSError:
        pass


@dataclass(frozen=True)
class AgentAdapter:
    """The single door for one agent: build its launch argv, then inject hooks.

    A frozen value object — no per-agent subclasses. The registry entries are
    data: each carries its slug plus the callables the public methods delegate
    to. Resume support is optional and represented by ``_resume_command``.
    """

    slug: str
    _command: Callable[[str, str | None, str | None], list[str]]
    _inject: Callable[..., list[str]]
    _resume_command: Callable[[str], list[str]] | None = None
    supports_worktracker_mcp: bool = False
    supports_required_skills: bool = True

    def command(
        self,
        prompt: str,
        *,
        model: str | None = None,
        reasoning: str | None = None,
        activated_providers: Set[str] | None = None,
    ) -> list[str]:
        """Return launch argv with only provider-validated optional settings.

        Closed by default: leaving ``activated_providers`` unset reads the host
        catalog, so a deactivated provider is refused here even if a caller
        forgot to check. Command construction can run on the async launch path,
        where that sync ORM read is illegal — such a caller passes the set it
        already loaded off-thread (see ``TerminalSessionService.spawn``) rather
        than opting out of the gate.
        """

        try:
            _, model, reasoning = validate_provider_options(
                agent=self.slug,
                model=model,
                reasoning=reasoning,
                activated_providers=activated_providers,
            )
        except LaunchBindingError as exc:
            raise LaunchConfigurationError(exc.code) from exc

        return self._command(prompt, model, reasoning)

    def inject(
        self,
        argv: list[str],
        agent_run_id: str,
        *,
        lifecycle_url: str,
        mcp_url: str,
    ) -> list[str]:
        """Splice this run's lifecycle hooks (and MCP config) into ``argv``.

        Both URLs are required — the caller (``terminals.launch``) resolves
        them before any durable launch state is created.
        """
        return self._inject(argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url)

    @property
    def available_worktracker_tools(self) -> frozenset[str]:
        return WORKTRACKER_TOOLS if self.supports_worktracker_mcp else frozenset()

    def augment_launch(
        self,
        argv: list[str],
        agent_run_id: str,
        *,
        lifecycle_url: str,
        mcp_url: str,
        skills: ResolvedSkills,
    ) -> LaunchAugmentation:
        """Return argv, environment, and owned temp artifacts for one launch.

        Required skills are installed persistently during Ticketry startup.
        Launch augmentation is limited to lifecycle and MCP configuration.
        """
        del skills

        if self.slug == "claude":
            injected = self.inject(
                argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url
            )
            return LaunchAugmentation(tuple(injected))

        if self.slug == "codex":
            injected = self.inject(
                argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url
            )
            return LaunchAugmentation(tuple(injected))

        root = _artifact_root(agent_run_id)
        try:
            settings_path = root / "settings.json"
            if self.slug == "agy":
                injected = inject_agy_lifecycle_settings(
                    argv,
                    agent_run_id,
                    lifecycle_url=lifecycle_url,
                    mcp_url=mcp_url,
                    settings_path=settings_path,
                )
                environment = {
                    injected[1].split("=", 1)[0]: injected[1].split("=", 1)[1]
                }
                provider_argv = injected[2:]
            elif self.slug == "gemini":
                injected = inject_gemini_lifecycle_settings(
                    argv,
                    agent_run_id,
                    lifecycle_url=lifecycle_url,
                    mcp_url=mcp_url,
                    settings_path=settings_path,
                )
                environment = {
                    injected[1].split("=", 1)[0]: injected[1].split("=", 1)[1]
                }
                provider_argv = injected[2:]
            else:
                raise RuntimeError(f"no launch augmenter registered for {self.slug}")
            return LaunchAugmentation(
                tuple(provider_argv),
                tuple(environment.items()),
                (root,),
            )
        except Exception:
            cleanup_temporary_artifacts((root,))
            raise

    @property
    def supports_resume(self) -> bool:
        """Whether this agent can resume from a provider-native session id."""
        return self._resume_command is not None

    def resume_command(self, provider_session_id: str) -> list[str]:
        """Build the resume launch argv for this agent.

        Raises :class:`ResumeUnsupported` for agents without a resume builder.
        """
        if not isinstance(provider_session_id, str) or not provider_session_id:
            raise ValueError("provider_session_id must be a non-empty str")
        if self._resume_command is None:
            raise ResumeUnsupported(self.slug)
        return self._resume_command(provider_session_id)


def _inject_claude(argv, agent_run_id, *, lifecycle_url, mcp_url):
    return inject_claude_lifecycle_settings(
        argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url
    )


def _inject_agy(argv, agent_run_id, *, lifecycle_url, mcp_url):
    return inject_agy_lifecycle_settings(
        argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url
    )


def _inject_codex(argv, agent_run_id, *, lifecycle_url, mcp_url):
    return inject_codex_lifecycle_settings(
        argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url
    )


def _inject_gemini(argv, agent_run_id, *, lifecycle_url, mcp_url):
    return inject_gemini_lifecycle_settings(
        argv,
        agent_run_id,
        lifecycle_url=lifecycle_url,
        mcp_url=mcp_url,
    )


def _resume_claude(provider_session_id: str) -> list[str]:
    return ["claude", "--allow-dangerously-skip-permissions", "--resume", provider_session_id]


def _resume_agy(provider_session_id: str) -> list[str]:
    return ["agy", "--dangerously-skip-permissions", "--conversation", provider_session_id]


def _resume_codex(provider_session_id: str) -> list[str]:
    return ["codex", "resume", provider_session_id]


def _resume_gemini(provider_session_id: str) -> list[str]:
    return [
        "gemini",
        "--approval-mode",
        "yolo",
        "--resume",
        provider_session_id,
    ]


def _command_claude(
    prompt: str, model: str | None, reasoning: str | None
) -> list[str]:
    options = []
    if model is not None:
        options.extend(["--model", model])
    if reasoning is not None:
        options.extend(["--effort", reasoning])
    return ["claude", "--allow-dangerously-skip-permissions", *options, prompt]


def _command_agy(
    prompt: str, model: str | None, reasoning: str | None
) -> list[str]:
    del reasoning
    options = ["--model", model] if model is not None else []
    return ["agy", "--dangerously-skip-permissions", *options, "-i", prompt]


def _command_codex(
    prompt: str, model: str | None, reasoning: str | None
) -> list[str]:
    options = []
    if model is not None:
        options.extend(["--model", model])
    if reasoning is not None:
        options.extend(["-c", f'model_reasoning_effort="{reasoning}"'])
    return ["codex", *options, prompt]


def _command_gemini(
    prompt: str, model: str | None, reasoning: str | None
) -> list[str]:
    del reasoning
    options = ["--model", model] if model is not None else []
    return ["gemini", "--approval-mode", "yolo", *options, prompt]


_REGISTRY: dict[str, AgentAdapter] = {
    "claude": AgentAdapter(
        "claude",
        _command_claude,
        _inject_claude,
        _resume_command=_resume_claude,
        supports_worktracker_mcp=True,
    ),
    "agy": AgentAdapter(
        "agy",
        _command_agy,
        _inject_agy,
        _resume_command=_resume_agy,
        supports_worktracker_mcp=True,
    ),
    "codex": AgentAdapter(
        "codex",
        _command_codex,
        _inject_codex,
        _resume_command=_resume_codex,
        supports_worktracker_mcp=True,
    ),
    "gemini": AgentAdapter(
        "gemini",
        _command_gemini,
        _inject_gemini,
        _resume_command=_resume_gemini,
        supports_worktracker_mcp=True,
    ),
}

if set(_REGISTRY) != set(PROVIDER_CAPABILITIES):
    raise RuntimeError(
        "Agent registry and launch-binding provider capabilities must declare "
        "the same agent slugs."
    )


def get_adapter(slug: str) -> AgentAdapter:
    """Return the adapter for ``slug`` or raise :class:`UnknownAgent`."""
    try:
        return _REGISTRY[slug]
    except KeyError:
        raise UnknownAgent(slug) from None


def all_slugs() -> tuple[str, ...]:
    """Return every registered agent slug, in registration order."""
    return tuple(_REGISTRY)
