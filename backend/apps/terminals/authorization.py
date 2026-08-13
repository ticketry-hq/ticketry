"""Run-scoped authorization for agent-initiated terminal control."""

from __future__ import annotations

from django.core import signing


RUN_AUTHORIZATION_SALT = "muxed.terminals.current-run.v1"
RUN_AUTHORIZATION_MAX_AGE_SECONDS = 24 * 60 * 60


class RunAuthorizationError(ValueError):
    """The supplied authorization does not identify a signed Studio run."""


def issue_run_authorization(agent_run_id: str) -> str:
    """Return a Bearer credential bound to exactly one durable run id."""

    token = signing.dumps(
        {"agent_run_id": agent_run_id},
        salt=RUN_AUTHORIZATION_SALT,
        compress=False,
    )
    return f"Bearer {token}"


def verify_run_authorization(
    authorization: str | None,
    *,
    max_age: int | None = RUN_AUTHORIZATION_MAX_AGE_SECONDS,
) -> str:
    """Verify a Studio-issued Bearer credential and return its run id."""

    if not authorization:
        raise RunAuthorizationError("authorization_missing")
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token or " " in token:
        raise RunAuthorizationError("authorization_malformed")
    try:
        payload = signing.loads(
            token,
            salt=RUN_AUTHORIZATION_SALT,
            max_age=max_age,
        )
    except signing.SignatureExpired as exc:
        raise RunAuthorizationError("authorization_expired") from exc
    except signing.BadSignature as exc:
        raise RunAuthorizationError("authorization_invalid") from exc
    if not isinstance(payload, dict) or set(payload) != {"agent_run_id"}:
        raise RunAuthorizationError("authorization_malformed")
    agent_run_id = payload["agent_run_id"]
    if not isinstance(agent_run_id, str) or not agent_run_id:
        raise RunAuthorizationError("authorization_malformed")
    return agent_run_id
