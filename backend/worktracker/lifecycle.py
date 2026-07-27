"""The internal planning-lifecycle machine (#758).

A second, internal axis on ``Issue`` (``lifecycle_state``), orthogonal to the
visible ``Issue.state`` FK. This module is the **sole writer** of that field
(``set_lifecycle``) and the single source of truth for two rules:

1. **Transition validity** — a target must be in the current state's allowed-next
   set (:data:`TRANSITIONS`); strict terminals have none, ``failed`` has one
   recovery edge, and a ``None`` lifecycle enters at :data:`ENTRY`.
2. **Pairing validity** — the resulting ``(lifecycle_state, Issue.state)`` combo
   must be legal per :data:`PAIRING`, keyed on the visible *state group*
   (``state_groups.state_group``), not the state name.

This slice **defines and validates** the pairing; it never performs the visible
``Issue.state`` move (per the #744 HLD). Framework-neutral: imports only the enum
vocabulary, ``state_group``, and the existing ``ValidationError`` — so
``InvalidTransition`` rides the existing ``_http_errors`` seam as HTTP 422 with no
new mapping code.
"""

from django.db import transaction

from worktracker.models import LIFECYCLE_CHOICES
from worktracker.services.errors import ValidationError
from worktracker.state_groups import state_group


# The 19 legal lifecycle values, in machine order.
VALUES = tuple(value for value, _label in LIFECYCLE_CHOICES)

# Strict terminals — no outgoing transition. ``failed`` is recoverable only to
# ``lld_approved`` so graph reset can re-arm an implementation leaf.
STRICT_TERMINALS = frozenset({"done", "cancelled"})

# Where a fresh (``NULL``) lifecycle may enter: a root at ``backlog``, a split
# leaf at ``split_created``.
ENTRY = frozenset({"backlog", "split_created"})

# Forward + rejection-loop back-edges per active state, BEFORE the universal
# ``failed``/``cancelled`` escape hatches are folded in below. ``*_review`` rows
# carry the back-edge to the matching ``*_generating``/``refining`` so a rejected
# artifact loops without inventing a "rejected" state.
_FORWARD = {
    "backlog": {"refining"},
    "refining": {"prd_generated"},
    "prd_generated": {"prd_review"},
    "prd_review": {"prd_approved", "refining"},
    "prd_approved": {"generating_hld"},
    "generating_hld": {"hld_generated"},
    "hld_generated": {"hld_review"},
    "hld_review": {"hld_approved", "generating_hld"},
    "hld_approved": {"registering_split"},
    "registering_split": {"split_created"},
    "split_created": {"lld_generating"},
    "lld_generating": {"lld_generated"},
    "lld_generated": {"lld_review"},
    "lld_review": {"lld_approved", "lld_generating"},
    "lld_approved": {"implementing"},
    "implementing": {"done"},
}

# ``failed``/``cancelled`` are reachable from ANY active state (and ARE part of
# the allowed set, not a UI-only affordance). Terminals get an empty set.
TRANSITIONS = {
    state: frozenset(nexts | {"failed", "cancelled"})
    for state, nexts in _FORWARD.items()
}
for _terminal in STRICT_TERMINALS:
    TRANSITIONS[_terminal] = frozenset()
TRANSITIONS["failed"] = frozenset({"lld_approved"})

# Pairing: a constrained lifecycle value requires a specific visible state group.
# ``failed`` and a ``None`` lifecycle carry NO constraint (absent from the map).
# Todo and Blocked share the ``unstarted`` group — both legal for the design →
# split → leaf-LLD phase, by design.
PAIRING = {
    "backlog": "backlog",
    "refining": "backlog",
    "prd_generated": "backlog",
    "prd_review": "backlog",
    "prd_approved": "unstarted",
    "generating_hld": "unstarted",
    "hld_generated": "unstarted",
    "hld_review": "unstarted",
    "hld_approved": "unstarted",
    "registering_split": "unstarted",
    "split_created": "unstarted",
    "lld_generating": "unstarted",
    "lld_generated": "unstarted",
    "lld_review": "unstarted",
    "lld_approved": "unstarted",
    "implementing": "started",
    "done": "completed",
    "cancelled": "cancelled",
}


# Module-load reconciliation: enum and machine cannot silently drift. Every
# table key and every listed target must be one of the 19 enum values.
_VALUE_SET = frozenset(VALUES)
assert len(VALUES) == 19, "lifecycle enum must hold exactly 19 values"
assert ENTRY <= _VALUE_SET
assert STRICT_TERMINALS <= _VALUE_SET
assert set(TRANSITIONS) == _VALUE_SET, "every state needs a transition row"
for _state, _nexts in TRANSITIONS.items():
    assert _nexts <= _VALUE_SET, f"unknown target in {_state} row"
assert set(PAIRING) <= _VALUE_SET
assert "failed" not in PAIRING, "failed forces no visible move"


class InvalidTransition(ValidationError):
    """A rejected lifecycle write — unknown target, illegal step, or illegal
    ``(lifecycle_state, state)`` pairing. Subclasses ``ValidationError`` so it
    surfaces as HTTP 422 through the existing ``_http_errors`` seam."""


def allowed_transitions(issue):
    """Return the legal-next lifecycle set for ``issue``, from memory only.

    Accepts a resolved ``Issue`` (reads ``.lifecycle_state`` — no DB query, safe
    on list endpoints), a bare state string, or ``None``. A ``None`` lifecycle
    returns the entry set; a strict terminal returns the empty set; ``failed``
    returns its recovery edge; an active state returns its row (which already
    includes ``failed``/``cancelled``).
    """

    state = getattr(issue, "lifecycle_state", issue)
    if state is None:
        return set(ENTRY)
    return set(TRANSITIONS.get(state, set()))


def set_lifecycle(issue, target):
    """Advance ``issue`` to ``target`` — the sole writer of ``lifecycle_state``.

    Five ordered checks, one persist. Operates on the resolved ``Issue`` handed
    in (the route hydrates + 404s upstream), like ``update_work_item``. Raises
    :class:`InvalidTransition` (422) on any illegal write; returns the mutated
    issue on success.
    """

    # 1. Unknown target — checked before the transition lookup so a typo can't
    #    masquerade as a terminal with an empty next-set.
    if target not in _VALUE_SET:
        raise InvalidTransition(f"Unknown lifecycle state: {target!r}.")

    # 2. Transition validity — covers forward steps not in the row, re-setting
    #    the same value, and any move out of a strict terminal.
    allowed = allowed_transitions(issue)
    if target not in allowed:
        raise InvalidTransition(
            f"Cannot transition lifecycle {issue.lifecycle_state!r} → {target!r}."
        )

    # 3. Pairing validity — the resulting (target, visible group) combo must be
    #    legal. ``failed`` / a null-constraint target skip this. Read the group
    #    fresh (avoids a stale FK cache after a state reassignment).
    required = PAIRING.get(target)
    if required is not None:
        group = state_group(issue.state_id)
        if group != required:
            raise InvalidTransition(
                f"Lifecycle {target!r} requires visible group {required!r}, "
                f"but the issue's state group is {group!r}."
            )

    # 4. Persist — narrow write, bumps the audit timestamp.
    issue.lifecycle_state = target
    with transaction.atomic():
        issue.save(update_fields=["lifecycle_state", "updated_at"])
    return issue
