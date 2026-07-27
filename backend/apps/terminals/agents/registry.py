"""One door per agent for command construction and lifecycle/MCP injection.

Before this module the launch path knew each agent twice: once in a
slug -> launch-argv command table (the retired ``commands`` module) and again
as a chain of four ``inject_<agent>_lifecycle_settings`` calls run
unconditionally, each a
no-op for the other three agents (guarded by ``argv[0] != slug``). An
:class:`AgentAdapter` folds both halves behind a single slug lookup: the
launch path asks the registry for the one adapter and calls
``command`` / ``inject`` on it, so cross-agent calling is structurally
impossible rather than merely idempotent.

Recorded decisions:

- **Gemini gets no MCP injection today.** Every adapter's :meth:`inject`
  accepts ``mcp_url`` for a uniform call site, but the Gemini adapter
  deliberately ignores it — its underlying injector wires lifecycle hooks
  only, no WorkTracker MCP server. This asymmetry is intentional; changing it is a
  separate ticket.
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
  :class:`apps.terminals.fakes.FakeAdapter`). Fakes must *replace* an existing
  slug, never add a new one — ``validation.VALID_AGENTS`` is an import-time
  snapshot of :func:`all_slugs`.
"""

from __future__ import annotations

from dataclasses import dataclass
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


class UnknownAgent(Exception):
    """No adapter is registered for the requested agent slug."""


class ResumeUnsupported(Exception):
    """No resume builder registered for this agent."""


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

    def command(
        self,
        prompt: str,
        *,
        model: str | None = None,
        reasoning: str | None = None,
    ) -> list[str]:
        """Return launch argv with only provider-validated optional settings."""

        try:
            _, model, reasoning = validate_provider_options(
                agent=self.slug,
                model=model,
                reasoning=reasoning,
                # Command construction can run on the async launch path. Host
                # activation is enforced before this already-resolved step.
                activated_providers=PROVIDER_CAPABILITIES.keys(),
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
        them. The Gemini adapter ignores ``mcp_url`` by design (see the module
        docstring).
        """
        return self._inject(argv, agent_run_id, lifecycle_url=lifecycle_url, mcp_url=mcp_url)

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
    # Gemini gets lifecycle hooks only, no MCP — mcp_url is accepted for a
    # uniform call site and deliberately dropped (recorded asymmetry).
    return inject_gemini_lifecycle_settings(argv, agent_run_id, lifecycle_url=lifecycle_url)


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
