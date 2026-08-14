"""Router-free workflow-state vocabulary: identity, groups, projection.

The five state groups (``backlog/unstarted/started/completed/cancelled``) live
on ``State`` in ``models``; this module holds the *interpretation* of those
groups — which ones count as "resolved", how to resolve a state id to its
group, how to normalize a state id for comparison, and how to project a state
row for the wire.

``State`` is imported lazily inside ``state_group`` so that app-init code
(``signals.py``, ``AppConfig.ready``, and ``models.issue`` itself) can import
this vocabulary without a cycle and without dragging in the DRF transport
surface. Keep it that way — nothing here may import ``worktracker.rest``.
"""

# A state group counts as "resolved" — the work is done or will never be done —
# in exactly the two terminal groups. Mirrors the frontend dependency view and
# the MCP scope-context projection.

RESOLVED_GROUPS = frozenset({"completed", "cancelled"})


def normalize_state_id(value):
    """Normalize UUID/string/None state ids for stable identity comparison."""

    return str(value) if value is not None else None


def state_group(state_id, *, using=None):
    """Return the group of a state by id, or ``None`` for no/unknown state.

    Read fresh from the table rather than via ``issue.state`` so the new-group
    lookup after a ``state_id`` reassignment can't return a stale cached FK.
    """

    from worktracker.models import State

    if not state_id:
        return None
    state = State.objects.using(using).filter(pk=state_id).only("group").first()
    return state.group if state else None


def workflow_state_projection(state) -> dict:
    return {
        "id": str(state.pk),
        "name": state.name,
        "group": state.group,
        "color": state.color,
        "sort_order": state.sort_order,
        "is_protected": state.is_protected,
    }
