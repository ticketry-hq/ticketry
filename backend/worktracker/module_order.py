"""The one place the server's Canonical module order is expressed.

A project's module ordering mode is the durable boolean
``Project.manual_module_order``:

* **Automatic** (the default, and what every existing project migrates into)
  orders newest-created-first. A module created a moment ago leads the list
  before it has any agent activity at all, and Studio layers agent-activity
  recency on top of this deterministic fallback.
* **Manual module order** orders by the module work items' ascending fractional
  ``Issue.rank`` — the durable arrangement a user dragged into place. Agent
  activity never participates.

Both modes break ties on ``id`` so the order is total and stable for rows that
share a rank (a project that has never been reordered has every module on the
empty-string rank) — no read ever depends on the database's row order.

Every module collection read — the REST route and the in-process query service
alike — orders through :func:`canonical_module_queryset`, so no surface can
drift into an order of its own.
"""

from django.db import connection
from django.db.models import F
from django.db.models.functions import Collate

from worktracker.models import Issue, Project
from worktracker.ranking import key_between

# Newest created first. ``sequence_id`` is the project's shared monotonic
# counter, so descending it is creation order reversed without reading clocks.
AUTOMATIC_ORDER = ("-sequence_id", "id")


def rank_ascending():
    """Order module ranks by their base-62 value, not by locale rules.

    ``worktracker.ranking`` keys are fractions over an ASCII-sorted base-62
    alphabet, so their *byte* order is their numeric order — but only under a
    byte-wise collation. PostgreSQL's default locale collation folds case, and
    would read the real key ``iHiH…`` as smaller than ``QZQZ…``; SQLite's
    default ``BINARY`` collation already compares bytes. So ask PostgreSQL for
    ``C`` explicitly and leave every other backend on its own default.

    A module list is a handful of rows per project, so giving up the ``rank``
    index for this sort costs nothing measurable.
    """

    if connection.vendor == "postgresql":
        return Collate(F("rank"), "C").asc()
    return F("rank").asc()


def module_ordering(manual_module_order: bool):
    """Return the ``order_by`` arguments for a project in this ordering mode."""

    if manual_module_order:
        # Ascending fractional rank, with the deterministic identifier fallback.
        return (rank_ascending(), "id")
    return AUTOMATIC_ORDER


def uses_manual_module_order(project_id) -> bool:
    """Read one project's durable ordering mode, defaulting to automatic.

    An unknown project is automatic rather than an error: the collection reads
    below answer an empty list for it, and inventing a lookup failure here
    would give the module routes a second not-found path.
    """

    return (
        Project.objects.filter(pk=project_id)
        .values_list("manual_module_order", flat=True)
        .first()
        or False
    )


def canonical_module_queryset(project_id, *, include_archived: bool = False):
    """Return one project's active modules in its Canonical module order."""

    queryset = Issue.objects.filter(project_id=project_id, type="module")
    if not include_archived:
        queryset = queryset.exclude(is_archived=True)
    return queryset.order_by(*module_ordering(uses_manual_module_order(project_id)))


def front_module_rank(project_id) -> str:
    """Return a rank sorting before every active module of this project (#362).

    A new module always enters at the front of the Canonical module order. In
    automatic mode the collection read already answers that for free — newest
    created is newest ``sequence_id`` — so only a manually ordered project needs
    a rank allocated, and this is the one place that allocates it.

    The bound is the *current first active* module's rank read in the project's
    own manual order, so the caller must hold the project row (see
    ``services.modules.create_module``) or a concurrent create could pick the
    same neighbor. An empty project has no lower bound at all.

    A manual project reaches manual mode through first-drag initialization,
    which seeds every visible module with a non-empty key, so the first rank is
    a real key. The ``or None`` below only covers the degenerate unseeded case,
    where no key can sort before the empty-string rank and the new module falls
    in behind it rather than raising.
    """

    first_rank = (
        canonical_module_queryset(project_id).values_list("rank", flat=True).first()
    )
    return key_between(None, first_rank or None)
