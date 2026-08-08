"""JSON-Schema contracts for the terminal WebSocket (#692 · T687-3).

WebSocket frames do not pass through DRF, so their structural contract is a
plain draft-07 schema.  The same schema validates inbound init frames and is
exported for Studio's contract tests; there is no second Python model layer.
Transport-independent semantic rules remain in :mod:`apps.terminals.validation`.
"""

from __future__ import annotations

from copy import deepcopy

from jsonschema import Draft7Validator


_MISSING = object()


def _property(
    name: str,
    kind: str,
    *,
    const: str | None = None,
    enum: list[str] | None = None,
    nullable: bool = False,
    default=_MISSING,
) -> dict:
    schema: dict = {"title": name.replace("_", " ").title()}
    value_schema: dict = {"type": kind}
    if const is not None:
        value_schema["const"] = const
    if enum is not None:
        value_schema["enum"] = enum
    if nullable:
        schema["anyOf"] = [value_schema, {"type": "null"}]
    else:
        schema.update(value_schema)
    if default is not _MISSING:
        schema["default"] = default
    return schema


def _frame(
    title: str,
    description: str,
    properties: dict[str, dict],
    required: list[str],
) -> dict:
    return {
        "description": description,
        "properties": properties,
        "required": required,
        "title": title,
        "type": "object",
    }


FRAME_SCHEMAS = [
    _frame(
        "InitSpawnFrame",
        'Client → server: spawn a fresh agent terminal (``mode:"spawn"``).',
        {
            "agent": _property(
                "agent", "string", enum=["claude", "agy", "codex", "gemini"]
            ),
            "cols": _property("cols", "integer"),
            "doc_id": _property("doc_id", "string", nullable=True),
            "doc_rel_path": _property("doc_rel_path", "string", nullable=True),
            "initial_prompt": _property("initial_prompt", "string", nullable=True),
            "instant_prompt": _property("instant_prompt", "string", nullable=True),
            "is_doc_chat": _property("is_doc_chat", "boolean"),
            "is_instant": _property("is_instant", "boolean"),
            "is_planning": _property("is_planning", "boolean"),
            "mode": _property("mode", "string", const="spawn"),
            "module_id": _property("module_id", "string"),
            "project_id": _property("project_id", "string"),
            "rows": _property("rows", "integer"),
            "task_id": _property("task_id", "string", nullable=True),
            "type": _property("type", "string", const="init"),
        },
        [
            "type",
            "mode",
            "agent",
            "project_id",
            "module_id",
            "task_id",
            "initial_prompt",
            "cols",
            "rows",
            "is_planning",
            "is_instant",
            "instant_prompt",
            "is_doc_chat",
            "doc_rel_path",
            "doc_id",
        ],
    ),
    _frame(
        "InitAttachFrame",
        'Client → server: reattach to a persisted tmux session (``mode:"attach"``).',
        {
            "agent_run_id": _property("agent_run_id", "string"),
            "cols": _property("cols", "integer"),
            "mode": _property("mode", "string", const="attach"),
            "rows": _property("rows", "integer"),
            "type": _property("type", "string", const="init"),
        },
        ["type", "mode", "agent_run_id", "cols", "rows"],
    ),
    _frame(
        "ReadyFrame",
        "Server → client: the session is live and streaming.",
        {
            "agent_run_id": _property(
                "agent_run_id", "string", nullable=True, default=None
            ),
            "session_id": _property("session_id", "string"),
            "type": _property("type", "string", const="ready"),
        },
        ["type", "session_id"],
    ),
    _frame(
        "ResizeFrame",
        "Client → server: terminal geometry changed.",
        {
            "cols": _property("cols", "integer"),
            "rows": _property("rows", "integer"),
            "type": _property("type", "string", const="resize"),
        },
        ["type", "cols", "rows"],
    ),
    _frame(
        "ScrollFrame",
        "Client → server: wheel/trackpad scroll bridged to tmux copy-mode (#578).",
        {
            "dir": _property("dir", "string", enum=["up", "down"]),
            "lines": _property("lines", "integer"),
            "type": _property("type", "string", const="scroll"),
        },
        ["type", "dir", "lines"],
    ),
    _frame(
        "ErrorFrame",
        "Server → client: a terminal error before/at close.",
        {
            "message": _property("message", "string"),
            "type": _property("type", "string", const="error"),
        },
        ["type", "message"],
    ),
]

_FRAME_VALIDATORS = {
    schema["title"]: Draft7Validator(schema) for schema in FRAME_SCHEMAS
}


def frame_is_valid(title: str, payload: object) -> bool:
    """Return whether ``payload`` satisfies the named exported frame schema."""

    return _FRAME_VALIDATORS[title].is_valid(payload)


def wire_frames_schema() -> dict:
    """Return the committed draft-07 schema for every terminal frame."""

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "Terminal WebSocket wire frames",
        "description": (
            "Generated by `manage.py export_wire_frames` from "
            "terminals/frames.py. Do not edit by hand."
        ),
        "oneOf": deepcopy(FRAME_SCHEMAS),
    }
