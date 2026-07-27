"""State-group interpretation, kept clear of the Ninja router.

The five state groups (``backlog/unstarted/started/completed/cancelled``) live
on ``State`` in ``models``; this module holds the *interpretation* of those
groups — which ones count as "resolved" and how to resolve a state id to its
group. It imports only ``State``, so app-init code (``signals.py``, #704) can
import the group vocabulary without dragging in the whole API surface.
"""

from worktracker.models import State

# A state group counts as "resolved" — the work is done or will never be done —
# in exactly the two terminal groups. Mirrors the FE issueStore.RESOLVED_GROUPS
# so the scope-context advisory and the dependency view speak the same language.

RESOLVED_GROUPS = frozenset({"completed", "cancelled"})


def state_group(state_id):
    """Return the group of a state by id, or ``None`` for no/unknown state.

    Read fresh from the table rather than via ``issue.state`` so the new-group
    lookup after a ``state_id`` reassignment can't return a stale cached FK.
    """

    if not state_id:
        return None
    state = State.objects.filter(pk=state_id).only("group").first()
    return state.group if state else None
