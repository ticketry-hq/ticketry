"""Fixture seeding for the Rust-owned Runs tables.

These helpers exist only under `tests/`. They are how a read or projection test
states "suppose this history already exists" — including histories no command
can produce, such as a run that ended months ago. They are deliberately not
importable from any production module, and the ownership test asserts that.
"""

from __future__ import annotations

from apps.runs.models import AgentRun


def seed_agent_run(run: AgentRun) -> AgentRun:
    """Insert one historical Agent Run row as test fixture data."""

    run.save(force_insert=True)
    return run


async def aseed_agent_run(run: AgentRun) -> AgentRun:
    await run.asave(force_insert=True)
    return run


def seed_run_exit(
    run_id: str,
    *,
    status: str,
    ended_at: str,
    exit_code: int | None = None,
    error: str | None = None,
) -> None:
    """Give a seeded run a historical terminal result."""

    AgentRun.objects.filter(id=run_id).update(
        status=status, ended_at=ended_at, exit_code=exit_code, error=error
    )


def seed_lifecycle_state(run_id: str, state: str, *, updated_at: str) -> None:
    """Give a seeded run a historical lifecycle state."""

    AgentRun.objects.filter(id=run_id).update(
        lifecycle_state=state, lifecycle_updated_at=updated_at
    )


def seed_provider_session(run_id: str, provider_session_id: str) -> None:
    AgentRun.objects.filter(id=run_id).update(
        provider_session_id=provider_session_id
    )
