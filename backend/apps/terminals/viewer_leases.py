"""Durable arbitration for the one active viewer of an agent run.

The control plane, rather than either terminal transport, owns this small
piece of state.  A successful acquisition is the policy decision: newest
acquisition wins; the prior holder observes replacement on its next renewal.
Neither acquiring nor releasing a lease interacts with tmux.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.runs.models import AgentRun
from apps.terminals.models import AgentRunViewerLease


LEASE_TTL_SECONDS = 30


class ViewerLeaseRunNotFound(Exception):
    """The durable run named by a viewer does not exist."""


@dataclass(frozen=True)
class ViewerLease:
    agent_run_id: str
    viewer_id: str
    transport: str
    expires_at: object
    replaced_viewer_id: str | None = None
    replaced_transport: str | None = None


def _ttl() -> timedelta:
    try:
        seconds = int(os.environ.get("MUXED_VIEWER_LEASE_TTL_SECONDS", LEASE_TTL_SECONDS))
    except ValueError:
        seconds = LEASE_TTL_SECONDS
    return timedelta(seconds=max(1, seconds))


def acquire(*, agent_run_id: str, viewer_id: str, transport: str) -> ViewerLease:
    """Acquire the lease, replacing any other viewer for this run.

    Locking the durable ``AgentRun`` first gives every contender the same
    serialization point, including first-time lease creation.
    """

    now = timezone.now()
    expires_at = now + _ttl()
    with transaction.atomic():
        try:
            AgentRun.objects.select_for_update().get(id=agent_run_id)
        except AgentRun.DoesNotExist as exc:
            raise ViewerLeaseRunNotFound(agent_run_id) from exc

        lease, _ = AgentRunViewerLease.objects.select_for_update().get_or_create(
            agent_run_id=agent_run_id,
            defaults={
                "viewer_id": viewer_id,
                "transport": transport,
                "acquired_at": now,
                "expires_at": expires_at,
            },
        )
        if lease.viewer_id == viewer_id:
            lease.transport = transport
            lease.expires_at = expires_at
            lease.save(update_fields=["transport", "expires_at"])
            return ViewerLease(agent_run_id, viewer_id, transport, expires_at)

        previous_viewer_id = lease.viewer_id
        previous_transport = lease.transport
        lease.viewer_id = viewer_id
        lease.transport = transport
        lease.acquired_at = now
        lease.expires_at = expires_at
        lease.save(update_fields=["viewer_id", "transport", "acquired_at", "expires_at"])
        return ViewerLease(
            agent_run_id,
            viewer_id,
            transport,
            expires_at,
            previous_viewer_id,
            previous_transport,
        )


def renew(*, agent_run_id: str, viewer_id: str) -> ViewerLease | None:
    """Extend a holder's lease, or report that it was replaced/expired."""

    now = timezone.now()
    expires_at = now + _ttl()
    with transaction.atomic():
        try:
            lease = AgentRunViewerLease.objects.select_for_update().get(
                agent_run_id=agent_run_id
            )
        except AgentRunViewerLease.DoesNotExist:
            return None
        if lease.viewer_id != viewer_id or lease.expires_at <= now:
            return None
        lease.expires_at = expires_at
        lease.save(update_fields=["expires_at"])
        return ViewerLease(agent_run_id, viewer_id, lease.transport, expires_at)


def release(*, agent_run_id: str, viewer_id: str) -> bool:
    """Release only the caller's lease; a newer viewer is never disturbed."""

    with transaction.atomic():
        deleted, _ = AgentRunViewerLease.objects.filter(
            agent_run_id=agent_run_id, viewer_id=viewer_id
        ).delete()
    return bool(deleted)
