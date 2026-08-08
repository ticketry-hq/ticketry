import json
from pathlib import Path

import jsonschema

from apps.runs.chat.codex_runtime import (
    initialize_params,
    thread_start_params,
    turn_start_params,
)


SCHEMA_ROOT = (
    Path(__file__).parents[2]
    / "chat"
    / "schema"
)
V2_SCHEMA_PATH = SCHEMA_ROOT / "codex_app_server_protocol.v2.schemas.json"
WIRE_SCHEMA_PATH = SCHEMA_ROOT / "codex_app_server_protocol.schemas.json"


def _validate(
    definition: str,
    instance: dict,
    *,
    schema_path: Path = V2_SCHEMA_PATH,
) -> None:
    bundle = json.loads(schema_path.read_text())
    schema = {
        **bundle["definitions"][definition],
        "$schema": bundle["$schema"],
        "definitions": bundle["definitions"],
    }
    jsonschema.Draft7Validator(schema).validate(instance)


def test_initialize_payload_matches_pinned_codex_contract():
    _validate("InitializeParams", initialize_params("0.1.0"))


def test_thread_start_payload_matches_pinned_codex_contract():
    _validate(
        "ThreadStartParams",
        thread_start_params(
            cwd="/tmp/ticketry-project",
            model="gpt-5.6-sol",
            service_tier="fast",
        ),
    )


def test_thread_resume_payload_matches_pinned_codex_contract():
    params = thread_start_params(cwd="/tmp/ticketry-project")
    _validate("ThreadResumeParams", {"threadId": "thread-1", **params})


def test_turn_start_payload_matches_pinned_codex_contract():
    _validate(
        "TurnStartParams",
        turn_start_params(
            thread_id="thread-1",
            prompt="Inspect this repository",
            model="gpt-5.6-sol",
            reasoning="ultra",
            service_tier="fast",
        ),
    )


def test_turn_interrupt_payload_matches_pinned_codex_contract():
    _validate(
        "TurnInterruptParams",
        {"threadId": "thread-1", "turnId": "turn-1"},
    )


def test_approval_responses_match_pinned_bidirectional_contract():
    for definition in (
        "CommandExecutionRequestApprovalResponse",
        "FileChangeRequestApprovalResponse",
    ):
        for decision in ("accept", "acceptForSession", "decline", "cancel"):
            _validate(
                definition,
                {"decision": decision},
                schema_path=WIRE_SCHEMA_PATH,
            )


def test_user_input_response_matches_pinned_bidirectional_contract():
    _validate(
        "ToolRequestUserInputResponse",
        {"answers": {"question-1": {"answers": ["yes"]}}},
        schema_path=WIRE_SCHEMA_PATH,
    )
