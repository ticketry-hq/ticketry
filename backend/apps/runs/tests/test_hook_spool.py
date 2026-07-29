"""Contract tests for the sandbox-safe packaged lifecycle hook spool."""

from __future__ import annotations

import json

from apps.runs import hook_spool


async def test_spooled_codex_event_reaches_normal_lifecycle_ingress(
    monkeypatch, tmp_path
):
    captured = []

    async def ingest(_request, event):
        captured.append(event)

    monkeypatch.setenv(hook_spool.HOOK_SPOOL_DIR_ENV, str(tmp_path))
    monkeypatch.setattr("apps.runs.api.ingest_lifecycle_event", ingest)
    path = tmp_path / "v1__codex__run-123__99-123456.hook"
    path.write_text(
        json.dumps(
            {
                "hook_event_name": "SessionStart",
                "session_id": "provider-session",
                "message": "ready",
            }
        )
    )

    assert await hook_spool.drain_once() == 1
    assert not path.exists()
    assert len(captured) == 1
    event = captured[0]
    assert event.agent_run_id == "run-123"
    assert event.agent == "codex"
    assert event.kind == "session_start"
    assert event.source == "hook"
    assert event.provider_session_id == "provider-session"
    assert event.message == "ready"


async def test_spool_uses_the_existing_provider_specific_event_mapping(
    monkeypatch, tmp_path
):
    captured = []

    async def ingest(_request, event):
        captured.append(event)

    monkeypatch.setenv(hook_spool.HOOK_SPOOL_DIR_ENV, str(tmp_path))
    monkeypatch.setattr("apps.runs.api.ingest_lifecycle_event", ingest)
    (tmp_path / "v1__agy__run-456__100-987654.hook").write_text(
        json.dumps(
            {
                "hook_event_name": "Notification",
                "conversationId": "agy-conversation",
            }
        )
    )

    assert await hook_spool.drain_once() == 1
    assert captured[0].kind == "awaiting_input"
    assert captured[0].provider_session_id == "agy-conversation"


async def test_malformed_or_unmapped_spool_files_are_discarded(
    monkeypatch, tmp_path
):
    async def unexpected_ingest(_request, _event):
        raise AssertionError("malformed events must not reach ingress")

    monkeypatch.setenv(hook_spool.HOOK_SPOOL_DIR_ENV, str(tmp_path))
    monkeypatch.setattr("apps.runs.api.ingest_lifecycle_event", unexpected_ingest)
    malformed = tmp_path / "v1__codex__run-123__99-malformed.hook"
    malformed.write_text("{")
    unmapped = tmp_path / "v1__codex__run-123__99-unmapped.hook"
    unmapped.write_text(json.dumps({"hook_event_name": "FutureEvent"}))

    assert await hook_spool.drain_once() == 0
    assert list(tmp_path.iterdir()) == []
