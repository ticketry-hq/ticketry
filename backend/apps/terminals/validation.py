"""Init-frame validation for the terminal WebSocket consumer.

Pure, side-effect-free: a decoded ``init`` payload in, a
``(validated request, error code)`` tuple out. Structure is checked against the
:mod:`apps.terminals.frames` wire models; the semantic rules that sit
deliberately outside the schema (geometry clamping, mutually-exclusive spawn
modes, doc-path safety, task-scope requirement) live here.

Two stages, both typed. The frame is the client's *raw* claim; the
:class:`SpawnRequest` / :class:`AttachRequest` returned here is the
*normalized* one — geometry clamped, doc fields resolved. Returning a typed
value rather than a dict means a downstream field typo is a name error at
import time, not a ``KeyError`` deep in an async spawn, which is the CODIN-685
bug class this module's dispatch already guards against structurally.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Union

from apps.terminals.agents.registry import all_slugs
from apps.terminals.frames import frame_is_valid


MAX_SESSIONS = 32
VALID_AGENTS = set(all_slugs())


@dataclass(frozen=True)
class SpawnRequest:
    """A validated, normalized spawn: geometry clamped, doc fields resolved."""

    agent: str
    project_id: str
    module_id: str
    task_id: Optional[str]
    initial_prompt: Optional[str]
    cols: int
    rows: int
    is_planning: bool
    is_instant: bool
    instant_prompt: Optional[str]
    is_doc_chat: bool
    doc_rel_path: Optional[str]
    doc_id: Optional[str]


@dataclass(frozen=True)
class AttachRequest:
    """A validated attach to an existing run, with clamped viewer geometry."""

    agent_run_id: str
    cols: int
    rows: int


#: What ``_validate_init`` yields on success. The two members replace the old
#: ``mode`` string key: ``isinstance`` is the discriminator.
InitRequest = Union[SpawnRequest, AttachRequest]


def _clamp_dim(value: int) -> int:
    return max(1, min(value, 1000))


def normalize_spawn_request(
    *,
    agent: str,
    project_id: str,
    module_id: str,
    task_id: Optional[str] = None,
    initial_prompt: Optional[str] = None,
    cols: int = 1,
    rows: int = 1,
    is_planning: bool = False,
    is_instant: bool = False,
    instant_prompt: Optional[str] = None,
    is_doc_chat: bool = False,
    doc_rel_path: Optional[str] = None,
    doc_id: Optional[str] = None,
) -> tuple[Optional[SpawnRequest], Optional[str]]:
    """Apply transport-neutral spawn rules to already typed input."""

    if agent not in VALID_AGENTS:
        return None, "unknown_agent"
    if not project_id or not module_id or cols <= 0 or rows <= 0:
        return None, "bad_init"
    if sum((is_planning, is_instant, is_doc_chat)) > 1:
        return None, "bad_init"

    if is_doc_chat:
        if not doc_rel_path or not doc_rel_path.strip():
            return None, "bad_init"
        if doc_rel_path.startswith("/") or os.path.isabs(doc_rel_path):
            return None, "bad_init"
        if any(part == ".." for part in doc_rel_path.split("/")):
            return None, "bad_init"
    else:
        doc_rel_path = None
        doc_id = None

    if not is_planning and not is_instant and not is_doc_chat and not task_id:
        return None, "bad_init"
    if is_instant and (not instant_prompt or not instant_prompt.strip()):
        return None, "bad_init"

    return (
        SpawnRequest(
            agent=agent,
            project_id=project_id,
            module_id=module_id,
            task_id=task_id,
            initial_prompt=initial_prompt,
            cols=_clamp_dim(cols),
            rows=_clamp_dim(rows),
            is_planning=is_planning,
            is_instant=is_instant,
            instant_prompt=instant_prompt,
            is_doc_chat=is_doc_chat,
            doc_rel_path=doc_rel_path,
            doc_id=doc_id,
        ),
        None,
    )


def _validate_init(payload: dict) -> tuple[Optional[InitRequest], Optional[str]]:
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


def _validate_attach_init(
    payload: dict,
) -> tuple[Optional[AttachRequest], Optional[str]]:
    # An attach frame must carry a non-empty run id; rejecting the mismatch is
    # what gives the discriminated union teeth.
    if not frame_is_valid("InitAttachFrame", payload):
        return None, "bad_init"
    if not payload["agent_run_id"]:
        return None, "bad_init"
    if payload["cols"] <= 0 or payload["rows"] <= 0:
        return None, "bad_init"
    return (
        AttachRequest(
            agent_run_id=payload["agent_run_id"],
            cols=_clamp_dim(payload["cols"]),
            rows=_clamp_dim(payload["rows"]),
        ),
        None,
    )


def _validate_spawn_init(
    payload: dict,
) -> tuple[Optional[SpawnRequest], Optional[str]]:
    # A spawn frame must NOT carry a run id — that would mean the client meant to
    # attach but mislabeled the frame.
    if payload.get("agent_run_id") is not None:
        return None, "bad_init"

    # Preserve the dedicated unknown_agent error code (the schema enum would only
    # surface a generic bad_init).
    if payload.get("agent") not in VALID_AGENTS:
        return None, "unknown_agent"

    if not frame_is_valid("InitSpawnFrame", payload):
        return None, "bad_init"

    return normalize_spawn_request(
        agent=payload["agent"],
        project_id=payload["project_id"],
        module_id=payload["module_id"],
        task_id=payload["task_id"],
        initial_prompt=payload["initial_prompt"],
        cols=payload["cols"],
        rows=payload["rows"],
        is_planning=payload["is_planning"],
        is_instant=payload["is_instant"],
        instant_prompt=payload["instant_prompt"],
        is_doc_chat=payload["is_doc_chat"],
        doc_rel_path=payload["doc_rel_path"],
        doc_id=payload["doc_id"],
    )
