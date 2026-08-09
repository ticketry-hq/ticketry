"""Tests for the per-agent lifecycle-settings injectors (#810, ADR-0003).

These cases were moved verbatim out of the four ``test_<agent>_hook.py`` files:
they exercise ``apps.terminals.agents.injectors`` (how each agent's launch
command is rewritten to wire the hook + MCP config), not the hook scripts. Bodies
are unchanged; same-named functions from different source files were renamed with
an agent prefix to avoid collision.
"""

import json
import os
import shlex
import tomllib

from apps.terminals.agents.injectors import claude as claude_injector
from apps.terminals.agents.injectors import codex as codex_injector
from apps.terminals.agents.injectors import gemini as gemini_injector
from apps.terminals.agents.injectors import agy as agy_injector
from apps.terminals.authorization import verify_run_authorization


def test_packaged_hook_runner_replaces_the_frozen_python_executable(monkeypatch):
    monkeypatch.setenv("MUXED_PACKAGED_HOOK_RUNNER", "/Applications/Muxed/ticketry-hook")
    monkeypatch.setenv("MUXED_HOOK_SPOOL_DIR", "/tmp/ticketry-hooks")

    hooks = codex_injector.build_codex_lifecycle_hooks(
        "run-xyz",
        "http://127.0.0.1:54321/api/lifecycle/events",
    )
    command = shlex.split(hooks["SessionStart"][0]["hooks"][0]["command"])

    assert command == [
        "/Applications/Muxed/ticketry-hook",
        "hook",
        "codex",
        "--spool-dir",
        "/tmp/ticketry-hooks",
        "--agent-run-id",
        "run-xyz",
        "--lifecycle-url",
        "http://127.0.0.1:54321/api/lifecycle/events",
    ]


# --- Claude ---------------------------------------------------------------


def test_inject_settings_for_claude():
    injector = claude_injector
    argv = ["claude", "--permission-mode", "auto", "do it"]
    out = injector.inject_claude_lifecycle_settings(argv, "run-xyz", "http://h/api")

    assert out[0] == "claude"
    assert out[1] == "--settings"

    settings = json.loads(out[2])
    assert settings["env"]["MUXED_AGENT_RUN_ID"] == "run-xyz"
    assert settings["env"]["MUXED_LIFECYCLE_URL"] == "http://h/api"
    assert "PreToolUse" in settings["hooks"]
    assert "Stop" in settings["hooks"]

    assert out[3] == "--mcp-config"
    mcp = json.loads(out[4])
    server = mcp["mcpServers"]["worktracker-agent"]
    assert set(server) == {"type", "url", "headers"}
    assert server["type"] == "http"
    assert server["url"] == injector.DEFAULT_MCP_URL
    assert set(server["headers"]) == {"Authorization"}
    assert verify_run_authorization(server["headers"]["Authorization"]) == "run-xyz"

    # Claude's own flags are preserved after the injected setting.

    assert out[5:] == ["--permission-mode", "auto", "do it"]


# --- Codex ----------------------------------------------------------------


def test_inject_settings_for_codex():
    injector = codex_injector
    argv = ["codex", "do it"]
    out = injector.inject_codex_lifecycle_settings(argv, "run-xyz", "http://h/api")

    config_overrides = [
        out[index + 1] for index, value in enumerate(out[:-1]) if value == "-c"
    ]
    assert 'approvals_reviewer="auto_review"' in config_overrides

    assert out[0] == "codex"
    assert out[1] == "-c"
    assert out[2].startswith("hooks=")
    assert out[3] == "-c"
    assert out[4].startswith("mcp_servers=")
    assert out[5:7] == ["-c", 'approvals_reviewer="auto_review"']
    assert out[7] == "--dangerously-bypass-hook-trust"

    # Codex parses ``-c key=value`` as TOML, so the hooks table is emitted as a
    # TOML inline table (not JSON, which Codex would reject as a literal string).

    hooks = tomllib.loads(out[2])["hooks"]
    assert "PreToolUse" in hooks
    assert "PermissionRequest" in hooks
    assert "Stop" in hooks

    # Run identity is baked into the hook command, not the environment.

    command = hooks["Stop"][0]["hooks"][0]["command"]
    assert "run-xyz" in command
    assert "http://h/api" in command

    mcp_servers = tomllib.loads(out[4])["mcp_servers"]
    server = mcp_servers["worktracker-agent"]
    assert server["url"] == injector.DEFAULT_MCP_URL
    assert set(server) == {"url", "http_headers"}
    assert set(server["http_headers"]) == {"Authorization"}
    assert (
        verify_run_authorization(server["http_headers"]["Authorization"])
        == "run-xyz"
    )

    # Codex's own args are preserved after the injected override.

    assert out[8:] == ["do it"]


def test_codex_inject_settings_places_resume_flags_after_subcommand():
    injector = codex_injector
    argv = ["codex", "resume", "sid-xyz"]
    out = injector.inject_codex_lifecycle_settings(argv, "run-xyz", "http://h/api")

    assert out[0] == "codex"
    assert out[1] == "resume"
    assert out[2] == "-c"
    assert out[4] == "-c"
    assert out[6:8] == ["-c", 'approvals_reviewer="auto_review"']
    assert out[8] == "--dangerously-bypass-hook-trust"
    assert out[-1] == "sid-xyz"


# --- Gemini ---------------------------------------------------------------


def test_gemini_build_settings_wires_events_and_identity():
    injector = gemini_injector
    settings = injector.build_gemini_lifecycle_settings("run-xyz", "http://h/api")
    hooks = settings["hooks"]

    assert "AfterAgent" in hooks
    assert "SessionStart" in hooks

    # Run identity is baked into the hook command, not the environment.

    command = hooks["AfterAgent"][0]["hooks"][0]["command"]
    assert "run-xyz" in command
    assert "http://h/api" in command

    # Gemini timeouts are in milliseconds.

    assert hooks["AfterAgent"][0]["hooks"][0]["timeout"] == 5000


def test_inject_settings_for_gemini_writes_temp_settings_layer():
    injector = gemini_injector
    argv = ["gemini", "--approval-mode", "yolo", "do it"]
    out = injector.inject_gemini_lifecycle_settings(argv, "run-xyz", "http://h/api")

    # The launch is wrapped so the system settings layer is relocated.

    assert out[0] == "env"
    assert out[1].startswith("GEMINI_CLI_SYSTEM_SETTINGS_PATH=")
    assert out[2] == "gemini"
    assert out[3] == "--skip-trust"

    # Gemini's own args are preserved after the trust flag.

    assert out[4:] == ["--approval-mode", "yolo", "do it"]

    # The referenced file holds the wired hooks with this run's identity.

    settings_path = out[1].split("=", 1)[1]
    try:
        with open(settings_path) as handle:
            written = json.load(handle)
        assert "AfterAgent" in written["hooks"]
        server = written["mcpServers"]["worktracker-agent"]
        authorization = server["headers"]["Authorization"]
        assert server == {
            "httpUrl": injector.DEFAULT_MCP_URL,
            "trust": True,
            "headers": {"Authorization": authorization},
        }
        assert verify_run_authorization(authorization) == "run-xyz"
        command = written["hooks"]["AfterAgent"][0]["hooks"][0]["command"]
        assert "run-xyz" in command
    finally:
        os.unlink(settings_path)


# --- Antigravity (agy) ----------------------------------------------------


def test_agy_build_settings_wires_events_and_identity():
    injector = agy_injector
    settings = injector.build_agy_lifecycle_settings("run-xyz", "http://h/api")
    hooks = settings["hooks"]

    assert "Stop" in hooks
    assert "SessionStart" in hooks

    # Run identity is baked into the hook command, not the environment.

    command = hooks["Stop"][0]["hooks"][0]["command"]
    assert "run-xyz" in command
    assert "http://h/api" in command

    # agy timeouts are treated as milliseconds (Gemini lineage).

    assert hooks["Stop"][0]["hooks"][0]["timeout"] == 5000


def test_inject_settings_for_agy_writes_temp_settings_layer():
    injector = agy_injector
    argv = ["agy", "--dangerously-skip-permissions", "-i", "do it"]
    out = injector.inject_agy_lifecycle_settings(argv, "run-xyz", "http://h/api")

    # The launch is wrapped so the settings layer is relocated, with no added
    # CLI flags — agy's own argv is preserved verbatim after the executable.

    assert out[0] == "env"
    assert out[1].startswith("GEMINI_CLI_SYSTEM_SETTINGS_PATH=")
    assert out[2:] == ["agy", "--dangerously-skip-permissions", "-i", "do it"]

    # The referenced file holds the wired hooks with this run's identity.

    settings_path = out[1].split("=", 1)[1]
    try:
        with open(settings_path) as handle:
            written = json.load(handle)
        assert "Stop" in written["hooks"]
        command = written["hooks"]["Stop"][0]["hooks"][0]["command"]
        assert "run-xyz" in command
        server = written["mcpServers"]["worktracker-agent"]
        authorization = server["headers"]["Authorization"]
        assert server == {
            "httpUrl": injector.DEFAULT_MCP_URL,
            "trust": True,
            "headers": {"Authorization": authorization},
        }
        assert verify_run_authorization(authorization) == "run-xyz"
    finally:
        os.unlink(settings_path)
