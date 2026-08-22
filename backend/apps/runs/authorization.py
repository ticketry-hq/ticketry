"""Run-scoped credentials for the Rust-owned agent runtime."""

from django.core import signing

from apps.errors import ApplicationError
from apps.runs.models import AgentRun


RUN_AUTHORIZATION_SALT = "muxed.terminals.current-run.v1"
RUN_AUTHORIZATION_MAX_AGE_SECONDS = 24 * 60 * 60


def issue(agent_run_id: str) -> str:
    token = signing.dumps(
        {"agent_run_id": agent_run_id},
        salt=RUN_AUTHORIZATION_SALT,
        compress=False,
    )
    return f"Bearer {token}"


def verify(authorization: str | None) -> str:
    if not authorization:
        raise ApplicationError(401, "authorization_missing", code="caller_run_unbound")
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token or " " in token:
        raise ApplicationError(401, "authorization_malformed", code="caller_run_unbound")
    try:
        payload = signing.loads(
            token,
            salt=RUN_AUTHORIZATION_SALT,
            max_age=RUN_AUTHORIZATION_MAX_AGE_SECONDS,
        )
    except signing.SignatureExpired as exc:
        raise ApplicationError(401, "authorization_expired", code="caller_run_unbound") from exc
    except signing.BadSignature as exc:
        raise ApplicationError(401, "authorization_invalid", code="caller_run_unbound") from exc
    if not isinstance(payload, dict) or set(payload) != {"agent_run_id"}:
        raise ApplicationError(401, "authorization_malformed", code="caller_run_unbound")
    agent_run_id = payload["agent_run_id"]
    if not isinstance(agent_run_id, str) or not agent_run_id:
        raise ApplicationError(401, "authorization_malformed", code="caller_run_unbound")
    return agent_run_id


def principal(authorization: str | None) -> dict:
    agent_run_id = verify(authorization)
    run = AgentRun.objects.select_related("issue").filter(id=agent_run_id).first()
    if run is None:
        raise ApplicationError(404, "caller_run_unknown", code="caller_run_unknown")
    if run.ended_at is not None:
        raise ApplicationError(401, "caller_run_inactive", code="caller_run_unbound")
    return {
        "agent_run_id": run.id,
        "issue_id": str(run.issue_id),
        "project_id": str(run.issue.project_id),
        "scope": run.scope,
    }
