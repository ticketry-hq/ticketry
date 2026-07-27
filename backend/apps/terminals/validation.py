"""Init-frame validation for the terminal WebSocket consumer.

Pure, side-effect-free: a decoded ``init`` payload in, a ``(validated dict,
error code)`` tuple out. Structure is checked against the
:mod:`apps.terminals.frames` wire models; the semantic rules that sit
deliberately outside the schema (geometry clamping, mutually-exclusive spawn
modes, doc-path safety, task-scope requirement) live here.
"""

from __future__ import annotations

import os
from typing import Optional

from pydantic import ValidationError

from apps.terminals.agents.registry import all_slugs
from apps.terminals.frames import InitAttachFrame, InitSpawnFrame


MAX_SESSIONS = 32
VALID_AGENTS = set(all_slugs())


def _clamp_dim(value: int) -> int:
    return max(1, min(value, 1000))


def _validate_init(payload: dict) -> tuple[Optional[dict], Optional[str]]:
    """Validate an init frame, dispatching on the explicit ``mode`` field (#692).

    The client now sends ``mode:"spawn"|"attach"`` (T687-3); the backend no
    longer infers it from ``agent_run_id`` presence. Structure is validated from
    the declared :mod:`apps.terminals.frames` models; inconsistent frames (an
    ``attach`` without a run id, a ``spawn`` carrying one, or an unknown/missing
    ``mode``) are rejected. The semantic rules below — geometry clamping,
    mutually-exclusive spawn modes, doc-path safety, task-scope requirement —
    stay imperative here, as they are intentionally outside the wire schema.
    """

    if not isinstance(payload, dict):
        return None, "bad_init"
    if payload.get("type") != "init":
        return None, "bad_init"

    mode = payload.get("mode")
    if mode == "attach":
        return _validate_attach_init(payload)
    if mode == "spawn":
        return _validate_spawn_init(payload)
    # Missing/unknown mode — the CODIN-685 bug class — is now rejected outright
    # rather than guessed from agent_run_id presence.
    return None, "bad_init"


def _validate_attach_init(payload: dict) -> tuple[Optional[dict], Optional[str]]:
    # An attach frame must carry a non-empty run id; rejecting the mismatch is
    # what gives the discriminated union teeth.
    try:
        frame = InitAttachFrame.model_validate(payload)
    except ValidationError:
        return None, "bad_init"
    if not frame.agent_run_id:
        return None, "bad_init"
    if frame.cols <= 0 or frame.rows <= 0:
        return None, "bad_init"
    return (
        {
            "mode": "attach",
            "agent_run_id": frame.agent_run_id,
            "cols": _clamp_dim(frame.cols),
            "rows": _clamp_dim(frame.rows),
        },
        None,
    )


def _validate_spawn_init(payload: dict) -> tuple[Optional[dict], Optional[str]]:
    # A spawn frame must NOT carry a run id — that would mean the client meant to
    # attach but mislabeled the frame.
    if payload.get("agent_run_id") is not None:
        return None, "bad_init"

    # Preserve the dedicated unknown_agent error code (the schema enum would only
    # surface a generic bad_init).
    if payload.get("agent") not in VALID_AGENTS:
        return None, "unknown_agent"

    try:
        frame = InitSpawnFrame.model_validate(payload)
    except ValidationError:
        return None, "bad_init"

    if not frame.project_id or not frame.module_id:
        return None, "bad_init"
    if frame.cols <= 0 or frame.rows <= 0:
        return None, "bad_init"

    # The three spawn modes are mutually exclusive.
    if sum((frame.is_planning, frame.is_instant, frame.is_doc_chat)) > 1:
        return None, "bad_init"

    # #625: a doc-chat run must carry a safe, design-dir-relative .html path.
    doc_rel_path = frame.doc_rel_path
    if frame.is_doc_chat:
        if not doc_rel_path or not doc_rel_path.strip():
            return None, "bad_init"
        # Never let the path be absolute or escape its design directory.
        if doc_rel_path.startswith("/") or os.path.isabs(doc_rel_path):
            return None, "bad_init"
        if any(part == ".." for part in doc_rel_path.split("/")):
            return None, "bad_init"
    else:
        doc_rel_path = None

    # #625: the registered document id only applies to a doc-chat run.
    doc_id = frame.doc_id if frame.is_doc_chat else None

    # Only a task-scoped run requires a task id; plan/instant/doc-chat may be
    # scratch (no task) and fold under the reserved sentinel.
    task_id = frame.task_id
    if not frame.is_planning and not frame.is_instant and not frame.is_doc_chat:
        if not task_id:
            return None, "bad_init"

    # An instant run needs a non-empty change prompt.
    if frame.is_instant:
        if not frame.instant_prompt or not frame.instant_prompt.strip():
            return None, "bad_init"

    return (
        {
            "mode": "spawn",
            "agent": frame.agent,
            "project_id": frame.project_id,
            "module_id": frame.module_id,
            "task_id": task_id,
            "initial_prompt": frame.initial_prompt,
            "cols": _clamp_dim(frame.cols),
            "rows": _clamp_dim(frame.rows),
            "is_planning": frame.is_planning,
            "is_instant": frame.is_instant,
            "instant_prompt": frame.instant_prompt,
            "is_doc_chat": frame.is_doc_chat,
            "doc_rel_path": doc_rel_path,
            "doc_id": doc_id,
        },
        None,
    )
