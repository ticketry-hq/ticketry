"""The one channel Django uses to record a Runs fact after the handoff.

Every durable Runs write now happens in Rust. Django reaches it over the same
loopback listener that already carries MCP, using the per-launch credential the
supervisor issued. The contract each call keeps is the one the slice is built
on: the caller may acknowledge its own upstream only after this returns a
committed result, so a spool replay or an HTTP retry is safe by construction.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlsplit, urlunsplit

import httpx


logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 15.0


class RunsPortUnavailable(RuntimeError):
    """The Rust Runs runtime did not commit the fact. Do not acknowledge."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _base_url() -> str:
    """Derive the Runs ingress root from the MCP URL the launcher published."""

    mcp_url = os.environ.get("WORKTRACKER_MCP_URL", "").strip()
    if not mcp_url:
        raise RunsPortUnavailable("runs_port_unconfigured")
    parts = urlsplit(mcp_url)
    if not parts.scheme or not parts.netloc:
        raise RunsPortUnavailable("runs_port_unconfigured")
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


#: The per-launch credential the supervisor gives the sidecar. It is the same
#: secret the Rust ingress checks, so no second credential has to be minted.
CREDENTIAL_ENV = "MUXED_SIDECAR_CREDENTIAL"


def _credential() -> str:
    credential = os.environ.get(CREDENTIAL_ENV, "").strip()
    if not credential:
        raise RunsPortUnavailable("runs_port_unauthenticated")
    return credential


def _post(path: str, payload: dict) -> dict:
    url = f"{_base_url()}{path}"
    try:
        response = httpx.post(
            url,
            json=payload,
            headers={"x-api-key": _credential()},
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        raise RunsPortUnavailable("runs_port_unreachable") from None
    try:
        body = response.json()
    except ValueError:
        raise RunsPortUnavailable("runs_port_invalid_response") from None
    if response.status_code != 200 or body.get("ok") is not True:
        raise RunsPortUnavailable(str(body.get("code") or "runs_port_failed"))
    return body


def apply_lifecycle_fact(
    agent_run_id: str,
    kind: str,
    occurred_at: str,
    provider_session_id: str | None = None,
) -> dict:
    """Record one normalized provider lifecycle fact durably."""

    return _post(
        "/runs/lifecycle",
        {
            "agent_run_id": agent_run_id,
            "kind": kind,
            "occurred_at": occurred_at,
            "provider_session_id": provider_session_id,
        },
    )


def record_terminal_outcome(
    agent_run_id: str,
    outcome: str,
    occurred_at: str,
    exit_code: int | None = None,
) -> dict:
    """Record one explicit terminal outcome as durable terminal authority."""

    return _post(
        "/runs/terminal-outcome",
        {
            "agent_run_id": agent_run_id,
            "outcome": outcome,
            "occurred_at": occurred_at,
            "exit_code": exit_code,
        },
    )


def launch(intent: dict, snapshot: dict) -> dict:
    """Prepare and perform one launch: durable fact first, effect second.

    ``intent`` is the immutable launch intent only. It carries no command,
    path, environment, prompt, or credential — the terminal capability keeps
    that material in its own launch-request row and reads it back when Rust
    calls the executor.
    """

    return _post("/runs/launch", {"intent": intent, "snapshot": snapshot})


def prepare_launch(intent: dict, snapshot: dict) -> dict:
    """Persist the Agent Run, launch intent, and prepared effect atomically.

    Returns before any external effect exists. A rolled-back preparation leaves
    nothing an executor could act on, which is the whole point of the ordering.
    """

    return _post("/runs/prepare-launch", {"intent": intent, "snapshot": snapshot})


def settle_launch(
    effect_id: str,
    *,
    applied: bool,
    runtime_id: str | None = None,
    adopted: bool = False,
    code: str | None = None,
    message: str | None = None,
    retryable: bool = False,
    cleanup_confirmed: bool = False,
) -> dict:
    """Record the durable outcome of one prepared effect.

    ``cleanup_confirmed=False`` is the honest answer when the external runtime
    could not be proven gone: the effect stays cleanup-pending and its rows
    survive for reconciliation rather than being deleted underneath it.
    """

    return _post(
        "/runs/settle-launch",
        {
            "effect_id": effect_id,
            "applied": applied,
            "runtime_id": runtime_id,
            "adopted": adopted,
            "code": code,
            "message": message,
            "retryable": retryable,
            "cleanup_confirmed": cleanup_confirmed,
        },
    )


def materialize_attempt(
    occurrence_id: str,
    issue_id: str,
    project_id: str,
    from_state_id: str,
    to_state_id: str,
    workflow_revision: int,
) -> dict:
    """Materialize the pending root attempt for one committed occurrence.

    Re-delivery of the same occurrence returns the same row, so duplicate
    delivery cannot produce two attempts or two launches.
    """

    return _post(
        "/runs/attempt",
        {
            "occurrence_id": occurrence_id,
            "issue_id": issue_id,
            "project_id": project_id,
            "from_state_id": from_state_id,
            "to_state_id": to_state_id,
            "workflow_revision": workflow_revision,
        },
    )


def record_attempt_outcome(
    attempt_id: str,
    *,
    succeeded: bool,
    agent: str | None = None,
    agent_run_id: str | None = None,
    error: str | None = None,
    failure: dict | None = None,
    retryable: bool = False,
) -> dict:
    """Record one Automation Attempt's terminal outcome."""

    return _post(
        "/runs/attempt-outcome",
        {
            "attempt_id": attempt_id,
            "succeeded": succeeded,
            "agent": agent,
            "agent_run_id": agent_run_id,
            "error": error,
            "failure": failure,
            "retryable": retryable,
        },
    )
