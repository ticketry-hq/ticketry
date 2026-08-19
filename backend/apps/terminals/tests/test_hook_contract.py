"""Contract suite for the shared lifecycle-hook reporter (#810).

One parametrized suite over the four per-agent shims, replacing the old
per-adapter hook test files. Every shim declares a ``SPEC``; the shared
machinery it drives lives in ``apps.terminals.agents.hooks._reporter``. The
suite asserts, for each agent:

- every event -> kind mapping row, and per-agent unrecognized events -> None,
- exact wire-payload dicts AND key insertion order (byte-compat acceptance),
- self-disabling (no identity) and unmapped-event skipping,
- message passthrough only when truthy,
- provider-session extraction (string only; agy's two spellings; agy ignores
  generic session ids; non-str dropped for all; absent omitted),
- late/duplicate delivery still builds a valid payload,
- ``post_event`` swallows an unreachable server,
- ``parse_args`` argv reading / defaults / stray-arg tolerance,
- and — via a real subprocess per agent — the standalone ``import _reporter``
  fallback with garbage stdin exits 0 and prints nothing (ADR-0001).
"""

import socket
import subprocess
import sys

import pytest

from apps.terminals.agents.hooks import _reporter
from apps.terminals.agents.hooks import (
    claude_hook,
    codex_hook,
    gemini_hook,
    agy_hook,
)

# --- Agent fixtures -------------------------------------------------------

SHIMS = {
    "claude": claude_hook,
    "codex": codex_hook,
    "gemini": gemini_hook,
    "agy": agy_hook,
}

# Every wired event -> kind row per agent (copied from the adapter tables).

MAPPING_ROWS = {
    "claude": {
        "SessionStart": "session_start",
        "UserPromptSubmit": "turn_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "Notification": "awaiting_input",
        "PermissionRequest": "awaiting_input",
        "Stop": "turn_complete",
        "SessionEnd": "session_end",
    },
    "codex": {
        "SessionStart": "session_start",
        "UserPromptSubmit": "turn_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "PermissionRequest": "permission_required",
        # Codex's only end-of-activity hook: an open Codex terminal has stopped
        # because it is waiting for the user (#660), not because the run ended.
        "Stop": "awaiting_input",
    },
    "gemini": {
        "SessionStart": "session_start",
        "BeforeAgent": "turn_start",
        "BeforeTool": "tool_use",
        "AfterTool": "tool_use",
        "Notification": "awaiting_input",
        "AfterAgent": "turn_complete",
        "SessionEnd": "session_end",
    },
    "agy": {
        "SessionStart": "session_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "Notification": "awaiting_input",
        "Stop": "turn_complete",
        "SessionEnd": "session_end",
    },
}

# Per-agent unrecognized events (ported from each adapter's suite) + None.

UNRECOGNIZED_ROWS = {
    "claude": ["Garbage", None],
    "codex": ["PreCompact", "SubagentStop", "Garbage", None],
    "gemini": ["BeforeModel", "AfterModel", "PreCompress", "Garbage", None],
    "agy": ["PreInvocation", "PostInvocation", "Garbage", None],
}

# A recognized event name per agent whose kind is tool_use, for reuse.

SAMPLE_TOOL_EVENT = {
    "claude": "PreToolUse",
    "codex": "PreToolUse",
    "gemini": "BeforeTool",
    "agy": "PreToolUse",
}

# A recognized end-of-turn event per agent (for late/duplicate coverage). The
# kind it normalizes to is read from MAPPING_ROWS, since Codex's `Stop` reports
# `awaiting_input` while the others report `turn_complete`.

SAMPLE_END_OF_TURN_EVENT = {
    "claude": "Stop",
    "codex": "Stop",
    "gemini": "AfterAgent",
    "agy": "Stop",
}


def spec(agent):
    return SHIMS[agent].SPEC


def _mapping_ids():
    ids = []
    for agent, rows in MAPPING_ROWS.items():
        for name in rows:
            ids.append((agent, name))
    return ids


# --- 1. Event -> kind mapping rows ----------------------------------------


@pytest.mark.parametrize("agent,name", _mapping_ids())
def test_event_maps_to_kind(agent, name):
    assert _reporter.event_to_kind(spec(agent), name) == MAPPING_ROWS[agent][name]


@pytest.mark.parametrize("agent", list(SHIMS))
def test_adapter_declares_exactly_the_contract_mapping(agent):
    # Exhaustive, not row-by-row: a shim may not quietly add, drop, or re-point
    # an event. Correcting Codex `Stop` (#660) must leave every other Codex row
    # and every Claude/Gemini/agy row untouched.
    assert spec(agent).event_to_kind == MAPPING_ROWS[agent]


# --- 2. Unrecognized events -> None ---------------------------------------


@pytest.mark.parametrize(
    "agent,name",
    [(a, n) for a, names in UNRECOGNIZED_ROWS.items() for n in names],
)
def test_unrecognized_event_maps_to_none(agent, name):
    assert _reporter.event_to_kind(spec(agent), name) is None


# --- 3. Exact-dict payload + key order (byte-compat acceptance) ------------

EXPECTED_PAYLOADS = {
    "claude": {
        "agent_run_id": "run-123",
        "agent": "claude",
        "kind": "tool_use",
        "ts": "2026-06-01T00:00:00+00:00",
        "source": "hook",
    },
    "codex": {
        "agent_run_id": "run-123",
        "agent": "codex",
        "kind": "tool_use",
        "ts": "2026-06-01T00:00:00+00:00",
        "source": "hook",
    },
    "gemini": {
        "agent_run_id": "run-123",
        "agent": "gemini",
        "kind": "tool_use",
        "ts": "2026-06-01T00:00:00+00:00",
        "source": "hook",
    },
    "agy": {
        "agent_run_id": "run-123",
        "agent": "agy",
        "kind": "tool_use",
        "ts": "2026-06-01T00:00:00+00:00",
        "source": "hook",
    },
}


@pytest.mark.parametrize("agent", list(SHIMS))
def test_build_event_exact_dict_and_key_order(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent]},
        "run-123",
        "2026-06-01T00:00:00+00:00",
    )
    assert payload == EXPECTED_PAYLOADS[agent]
    # Pin insertion order: the base five keys, in this exact sequence.
    assert list(payload.keys()) == [
        "agent_run_id",
        "agent",
        "kind",
        "ts",
        "source",
    ]


@pytest.mark.parametrize("agent", list(SHIMS))
def test_build_event_key_order_with_message_and_session(agent):
    # A fully-populated payload pins the optional keys' trailing order too.
    key = spec(agent).provider_session_keys[0]
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {
            "hook_event_name": SAMPLE_TOOL_EVENT[agent],
            "message": "hello",
            key: "sess-abc",
        },
        "run-123",
        "2026-06-01T00:00:00+00:00",
    )
    assert payload == {
        "agent_run_id": "run-123",
        "agent": agent,
        "kind": "tool_use",
        "ts": "2026-06-01T00:00:00+00:00",
        "source": "hook",
        "message": "hello",
        "provider_session_id": "sess-abc",
    }
    assert list(payload.keys()) == [
        "agent_run_id",
        "agent",
        "kind",
        "ts",
        "source",
        "message",
        "provider_session_id",
    ]


# --- 4. Missing identity / unrecognized event -> None ---------------------


@pytest.mark.parametrize("agent", list(SHIMS))
def test_no_run_id_means_no_event(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_END_OF_TURN_EVENT[agent]},
        None,
        "t",
    )
    assert payload is None


@pytest.mark.parametrize("agent", list(SHIMS))
def test_unrecognized_event_means_no_event(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": "Garbage"},
        "r",
        "t",
    )
    assert payload is None


# --- 5. Message passthrough (only when truthy) ----------------------------


@pytest.mark.parametrize("agent", list(SHIMS))
def test_message_passthrough_when_present(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent], "message": "needs input"},
        "r",
        "t",
    )
    assert payload["message"] == "needs input"


@pytest.mark.parametrize("agent", list(SHIMS))
def test_empty_message_not_attached(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent], "message": ""},
        "r",
        "t",
    )
    assert "message" not in payload


# --- 6. Provider-session extraction ---------------------------------------


@pytest.mark.parametrize("agent", list(SHIMS))
def test_provider_session_string_captured(agent):
    key = spec(agent).provider_session_keys[0]
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent], key: "sess-uuid"},
        "r",
        "t",
    )
    assert payload["provider_session_id"] == "sess-uuid"


@pytest.mark.parametrize("agent", list(SHIMS))
def test_provider_session_absent_key_omitted(agent):
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent]},
        "r",
        "t",
    )
    assert "provider_session_id" not in payload


@pytest.mark.parametrize("agent", list(SHIMS))
def test_provider_session_non_string_ignored(agent):
    # ADR-0002: non-string garbage is dropped for every agent.
    key = spec(agent).provider_session_keys[0]
    payload = _reporter.build_event_from_hook(
        spec(agent),
        {"hook_event_name": SAMPLE_TOOL_EVENT[agent], key: 123},
        "r",
        "t",
    )
    assert "provider_session_id" not in payload


def test_agy_captures_both_conversation_spellings():
    for key in ("conversationId", "conversation_id"):
        payload = _reporter.build_event_from_hook(
            spec("agy"),
            {"hook_event_name": "SessionStart", key: "conv-uuid"},
            "r",
            "t",
        )
        assert payload["provider_session_id"] == "conv-uuid"


def test_agy_ignores_generic_session_ids():
    payload = _reporter.build_event_from_hook(
        spec("agy"),
        {
            "hook_event_name": "PreToolUse",
            "sessionId": "not-proven-resumable",
            "session_id": "also-not-proven-resumable",
        },
        "run-123",
        "t",
    )
    assert "provider_session_id" not in payload


# --- 7. Late / duplicate delivery still builds a valid payload ------------


@pytest.mark.parametrize("agent", list(SHIMS))
def test_late_or_duplicate_event_still_builds_valid_payload(agent):
    name = SAMPLE_END_OF_TURN_EVENT[agent]
    expected = MAPPING_ROWS[agent][name]
    first = _reporter.build_event_from_hook(
        spec(agent), {"hook_event_name": name}, "r", "t1"
    )
    late = _reporter.build_event_from_hook(
        spec(agent), {"hook_event_name": name}, "r", "t2"
    )
    assert first["kind"] == expected
    assert late["kind"] == expected
    assert late["ts"] == "t2"


# --- 8. post_event swallows an unreachable server -------------------------


def test_post_event_swallows_unreachable_server():
    # Reserve then close a port so the connection is refused.
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    url = f"http://127.0.0.1:{port}/api/lifecycle/events"
    payload = _reporter.build_payload(spec("claude"), "tool_use", "r", "t")

    # Must return cleanly even though nothing is listening.
    _reporter.post_event(url, payload, timeout=0.2)


# --- 9. parse_args --------------------------------------------------------


def test_parse_args_reads_identity_from_argv():
    args = _reporter.parse_args(
        ["--agent-run-id", "run-xyz", "--lifecycle-url", "http://h/api"]
    )
    assert args.agent_run_id == "run-xyz"
    assert args.lifecycle_url == "http://h/api"


def test_parse_args_defaults_when_absent():
    args = _reporter.parse_args([])
    assert args.agent_run_id is None
    assert args.lifecycle_url == _reporter.DEFAULT_LIFECYCLE_URL


def test_parse_args_ignores_stray_args():
    args = _reporter.parse_args(["--agent-run-id", "r", "--unknown", "junk"])
    assert args.agent_run_id == "r"
    assert args.lifecycle_url == _reporter.DEFAULT_LIFECYCLE_URL


# --- 10. Subprocess rows (standalone import fallback, ADR-0001) -----------


@pytest.mark.parametrize("agent", list(SHIMS))
def test_shim_runs_standalone_with_garbage_stdin(agent):
    # Run the shim exactly as an agent CLI would: python <abs path>. This is the
    # only exercise of the standalone ``import _reporter`` fallback. Garbage
    # (non-JSON) stdin must be swallowed: exit 0 and nothing on stdout. Point
    # the ingress at an unreachable URL and pass no identity so nothing posts.
    script_path = SHIMS[agent].__file__

    # Reserve then close a port so any POST would be refused (belt-and-braces).
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    result = subprocess.run(
        [sys.executable, script_path],
        input=b"this is not json",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"MUXED_LIFECYCLE_URL": f"http://127.0.0.1:{port}/api/lifecycle/events"},
    )

    assert result.returncode == 0
    assert result.stdout == b""
