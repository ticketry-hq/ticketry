"""Persistence for the terminal-output activity axis.

Owns exactly three columns of the durable terminal-session mirror: the newest
observed output identity, the monotonic per-session output sequence, and the
backend-owned stamp of the newest *changed* observation. Provider lifecycle
records and viewer state are written elsewhere and are never touched here.
"""

from __future__ import annotations

from django.db.models import F, Q

from apps.terminals.models import AgentTerminalSession


async def advance_output_identity(
    agent_run_id: str,
    *,
    identity: str,
    observed_at: str,
) -> bool:
    """Advance the activity axis only when the observed output changed.

    One conditional UPDATE does the compare-and-set, so concurrent or repeated
    observations of the same identity cannot double-count and the sequence
    advances atomically rather than through a read-modify-write.

    A run that already reached an authoritative outcome is never advanced.
    Explicit termination and confirmed hosted-command exit end the durable run
    and its terminal mirror together, but each is written by its own path, so
    both facts are required here: a late observation arriving after either one
    committed must not extend the inactivity deadline of a dead run (#663).

    :return: whether this observation actually advanced the session.
    """

    updated = await (
        AgentTerminalSession.objects.filter(
            agent_run_id=agent_run_id,
            terminated_at__isnull=True,
            agent_run__ended_at__isnull=True,
        )
        # `exclude(...)` alone would drop the first-ever observation: SQL
        # `NOT (NULL = x)` is NULL, not true. The explicit null branch keeps a
        # never-observed session eligible.
        .filter(Q(output_identity__isnull=True) | ~Q(output_identity=identity))
        .aupdate(
            output_identity=identity,
            output_sequence=F("output_sequence") + 1,
            last_output_at=observed_at,
        )
    )
    return updated > 0
