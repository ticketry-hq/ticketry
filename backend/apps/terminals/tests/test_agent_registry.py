"""Tests for the AgentAdapter registry (CODIN-809).

The registry is the one door for command construction and lifecycle/MCP
injection. These tests pin the per-agent argv byte-for-byte and drive the
*real* injection chain through ``launch._launch`` so the produced command is
what actually reaches tmux — the assertion the deleted claude-only
``test_spawn_injects_lifecycle_hooks`` used to make, now parametrized over all
four agents.
"""

from __future__ import annotations

import json
import os
import shlex
import tomllib

import pytest

import apps.terminals.launch as launch
import apps.terminals.validation as validation
from apps.terminals.agents.injectors.agy import _AGY_SYSTEM_SETTINGS_ENV
from apps.terminals.authorization import verify_run_authorization
from apps.terminals.agents.registry import (
    AgentAdapter,
    UnknownAgent,
    ResumeUnsupported,
    all_slugs,
    get_adapter,
)

from .test_consumers import _fake_tmux_session

pytestmark = pytest.mark.django_db(transaction=True)


_EXPECTED_COMMAND = {
    "claude": ["claude", "--allow-dangerously-skip-permissions", "hello"],
    "agy": ["agy", "--dangerously-skip-permissions", "-i", "hello"],
    "codex": ["codex", "hello"],
    "gemini": ["gemini", "--approval-mode", "yolo", "hello"],
}

_EXPECTED_RESUME_COMMAND = {
    "claude": ["claude", "--allow-dangerously-skip-permissions", "--resume", "sid-123"],
    "agy": ["agy", "--dangerously-skip-permissions", "--conversation", "sid-123"],
    "codex": ["codex", "resume", "sid-123"],
    "gemini": ["gemini", "--approval-mode", "yolo", "--resume", "sid-123"],
}

ALL_SLUGS = ("claude", "agy", "codex", "gemini")


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_command_matches_table(slug):
    assert get_adapter(slug).command("hello") == _EXPECTED_COMMAND[slug]


@pytest.mark.parametrize(
    ("slug", "model", "reasoning", "expected"),
    [
        (
            "claude",
            "sonnet",
            "high",
            [
                "claude",
                "--allow-dangerously-skip-permissions",
                "--model",
                "sonnet",
                "--effort",
                "high",
                "hello",
            ],
        ),
        (
            "agy",
            "vendor/model",
            None,
            [
                "agy",
                "--dangerously-skip-permissions",
                "--model",
                "vendor/model",
                "-i",
                "hello",
            ],
        ),
        (
            "codex",
            "gpt-5.4",
            "xhigh",
            [
                "codex",
                "--model",
                "gpt-5.4",
                "-c",
                'model_reasoning_effort="xhigh"',
                "hello",
            ],
        ),
        (
            "gemini",
            "gemini-3.1-pro-preview",
            None,
            [
                "gemini",
                "--approval-mode",
                "yolo",
                "--model",
                "gemini-3.1-pro-preview",
                "hello",
            ],
        ),
    ],
)
def test_command_maps_validated_provider_options(slug, model, reasoning, expected):
    assert get_adapter(slug).command(
        "hello", model=model, reasoning=reasoning
    ) == expected


def test_command_rejects_unsupported_provider_options():
    with pytest.raises(ValueError, match="unsupported_reasoning"):
        get_adapter("gemini").command("hello", reasoning="high")


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_resume_command_matches_table(slug):
    assert get_adapter(slug).resume_command("sid-123") == _EXPECTED_RESUME_COMMAND[slug]


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_supports_resume_is_true_for_registered_adapters(slug):
    assert get_adapter(slug).supports_resume


def test_resume_unsupported_raises_for_adapter_without_builder():
    adapter = AgentAdapter(
        "slug",
        lambda prompt, model, reasoning: ["slug", prompt],
        lambda *a, **kw: [],
    )
    assert not adapter.supports_resume
    with pytest.raises(ResumeUnsupported):
        adapter.resume_command("sid-123")


@pytest.mark.parametrize("provider_session_id", ["", None])
def test_resume_command_rejects_empty_session_id(provider_session_id):
    with pytest.raises(ValueError):
        get_adapter("claude").resume_command(provider_session_id)  # type: ignore[arg-type]


async def _launch_and_capture(monkeypatch, slug, argv) -> str:
    """Drive the real launch path and return the shlex-joined tmux command.

    Mirrors the ``test_session_spawn`` harness: capture ``create_session``'s
    command and no-op the design-dir watcher, so the only thing exercised is
    the registry-routed injection ``_launch`` runs.
    """
    captured: dict = {}

    def fake_create_session(**kwargs):
        captured.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(launch.tmux, "create_session", fake_create_session)
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kw: None)

    await launch._launch(
        agent=slug,
        project_id="p1",
        module_id="m1",
        task_id="t1",
        argv=argv,
        cwd="/tmp",
        design_dir=None,
        scope="task",
        doc_rel_path=None,
        workspace_slug="ws",
        agent_run_id="deadbeef",
    )
    return captured["command"]


async def test_launch_injects_packaged_runtime_urls_from_the_sidecar_environment(monkeypatch):
    captured: dict = {}

    class RecordingAdapter:
        def inject(self, argv, agent_run_id, *, lifecycle_url, mcp_url):
            captured["injection"] = (agent_run_id, lifecycle_url, mcp_url)
            return argv

    monkeypatch.setattr(launch, "get_adapter", lambda _slug: RecordingAdapter())
    monkeypatch.setattr(
        launch.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)
    monkeypatch.setenv(
        "MUXED_LIFECYCLE_URL",
        "http://127.0.0.1:54321/api/lifecycle/events",
    )
    monkeypatch.setenv("WORKTRACKER_MCP_URL", "http://127.0.0.1:54322/mcp")

    await launch._launch(
        agent="codex",
        project_id="p1",
        module_id="m1",
        task_id="t-runtime-urls",
        argv=["codex", "hello"],
        cwd="/tmp",
        design_dir=None,
        scope="task",
        doc_rel_path=None,
        workspace_slug="ws",
        agent_run_id="runtime-urls-run",
    )

    assert captured["injection"] == (
        "runtime-urls-run",
        "http://127.0.0.1:54321/api/lifecycle/events",
        "http://127.0.0.1:54322/mcp",
    )


async def test_claude_real_injection(monkeypatch):
    command = await _launch_and_capture(
        monkeypatch, "claude", get_adapter("claude").command("hello")
    )
    assert "--settings" in command
    assert "--mcp-config" in command
    argv = shlex.split(command)
    mcp = json.loads(argv[argv.index("--mcp-config") + 1])
    authorization = mcp["mcpServers"]["worktracker-agent"]["headers"]["Authorization"]
    assert verify_run_authorization(authorization) == "deadbeef"


def _injected_mcp_authorization(slug: str, argv: list[str]) -> str:
    if slug == "claude":
        mcp = json.loads(argv[argv.index("--mcp-config") + 1])
        return mcp["mcpServers"]["worktracker-agent"]["headers"]["Authorization"]
    if slug == "codex":
        serialized = next(value for value in argv if value.startswith("mcp_servers="))
        mcp = tomllib.loads(serialized)["mcp_servers"]
        return mcp["worktracker-agent"]["http_headers"]["Authorization"]

    settings_path = argv[1].split("=", 1)[1]
    try:
        with open(settings_path) as handle:
            settings = json.load(handle)
        return settings["mcpServers"]["worktracker-agent"]["headers"][
            "Authorization"
        ]
    finally:
        os.unlink(settings_path)


@pytest.mark.parametrize("slug", ("claude", "codex", "agy"))
def test_mcp_enabled_adapter_resume_receives_a_fresh_run_authorization(slug):
    adapter = get_adapter(slug)
    first = adapter.inject(
        adapter.command("hello"),
        "run-original",
        lifecycle_url="http://x/lifecycle",
        mcp_url="http://x/mcp",
    )
    resumed = adapter.inject(
        adapter.resume_command("provider-session"),
        "run-resumed",
        lifecycle_url="http://x/lifecycle",
        mcp_url="http://x/mcp",
    )

    first_authorization = _injected_mcp_authorization(slug, first)
    resumed_authorization = _injected_mcp_authorization(slug, resumed)
    assert first_authorization != resumed_authorization
    assert verify_run_authorization(first_authorization) == "run-original"
    assert verify_run_authorization(resumed_authorization) == "run-resumed"


async def test_codex_real_injection(monkeypatch):
    command = await _launch_and_capture(
        monkeypatch, "codex", get_adapter("codex").command("hello")
    )
    # shlex.join quotes each -c value, so the markers appear as `-c 'hooks=…'`.
    assert "-c" in shlex.split(command)
    assert "hooks=" in command
    assert "mcp_servers=" in command
    assert "--dangerously-bypass-hook-trust" in command


async def test_gemini_real_injection_has_no_mcp(monkeypatch):
    command = await _launch_and_capture(
        monkeypatch, "gemini", get_adapter("gemini").command("hello")
    )
    assert command.startswith("env GEMINI_CLI_SYSTEM_SETTINGS_PATH=")
    assert "--skip-trust" in command
    # Recorded asymmetry: Gemini gets lifecycle hooks but no MCP config today.
    assert "mcp_servers" not in command
    assert "--mcp-config" not in command
    assert "mcpServers" not in command


async def test_agy_real_injection(monkeypatch):
    command = await _launch_and_capture(
        monkeypatch, "agy", get_adapter("agy").command("hello")
    )
    assert command.startswith(f"env {_AGY_SYSTEM_SETTINGS_ENV}=")


@pytest.mark.parametrize(
    ("slug",),
    [
        ("claude",),
        ("agy",),
        ("codex",),
        ("gemini",),
    ],
)
def test_resume_command_injection_round_trip(slug):
    sid = "sid-123"
    adapter = get_adapter(slug)
    injected = adapter.inject(
        adapter.resume_command(sid),
        "run1",
        lifecycle_url="http://x/lifecycle",
        mcp_url="http://x/mcp",
    )
    if slug == "claude":
        assert injected[0] == "claude"
        assert injected[1] == "--settings"
        assert injected[3] == "--mcp-config"
    elif slug == "agy":
        assert injected[0] == "env"
        assert injected[1].startswith(f"{_AGY_SYSTEM_SETTINGS_ENV}=")
        assert injected[2] == "agy"
    elif slug == "codex":
        assert injected[0] == "codex"
        assert injected[1] == "resume"
        assert injected[2] == "-c"
        assert injected[6:8] == ["-c", 'approvals_reviewer="auto_review"']
        assert injected[8] == "--dangerously-bypass-hook-trust"
    else:
        assert injected[0] == "env"
        assert injected[1].startswith("GEMINI_CLI_SYSTEM_SETTINGS_PATH=")
        assert injected[2] == "gemini"
        assert injected[3] == "--skip-trust"
    assert sid in injected


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_adapter_routes_only_its_own_slug(slug):
    # Structural single-routing: an adapter reports its own slug and, applied
    # to its own command argv, actually injects (changes the argv). Cross-agent
    # no-op assertions are obsolete — the registry hands each caller exactly one
    # adapter, so cross-calling is structurally impossible.
    adapter = get_adapter(slug)
    assert adapter.slug == slug
    argv = adapter.command("hello")
    injected = adapter.inject(
        argv, "run1", lifecycle_url="http://x/lifecycle", mcp_url="http://x/mcp"
    )
    assert injected != argv


def test_get_adapter_unknown_raises():
    with pytest.raises(UnknownAgent):
        get_adapter("nope")


def test_valid_agents_tracks_registry():
    assert validation.VALID_AGENTS == set(all_slugs())
    assert isinstance(all_slugs(), tuple)
