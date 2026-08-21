"""The one place the server's Canonical module order is expressed.

A project's module ordering mode is encoded by module presentation rows:

* **Automatic** (the default, and what every existing project migrates into)
  orders newest-created-first. A module created a moment ago leads the list
  before it has any agent activity at all, and Studio layers agent-activity
  recency on top of this deterministic fallback.
* **Manual module order** has a non-empty ``ModulePresentation.rank`` and orders
  modules by that ascending fractional key. Agent activity never participates.

Both modes break ties on ``id`` so the order is total and stable for rows that
share a rank. No read depends on the database's row order.

Every module collection read — the REST route and the in-process query service
alike — orders through :func:`canonical_module_queryset`, so no surface can
drift into an order of its own.
"""

from django.db import connection
from django.db.models import F
from django.db.models.functions import Collate

from worktracker.models import Issue, ModulePresentation
from worktracker.ranking import key_between

# Newest created first. ``sequence_id`` is the project's shared monotonic
# counter, so descending it is creation order reversed without reading clocks.
AUTOMATIC_ORDER = ("-sequence_id", "id")


def rank_ascending(field):
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
        return Collate(F(field), "C").asc()
    return F(field).asc()


def uses_manual_module_order(project_id) -> bool:
    """Return whether ranked presentation records define this project's order."""

    return (
        ModulePresentation.objects.filter(
            module__project_id=project_id,
            module__type="module",
        )
        .exclude(rank="")
        .exists()
    )


def canonical_module_queryset(project_id, *, include_archived: bool = False):
    """Return one project's active modules in its Canonical module order."""

    queryset = Issue.objects.filter(project_id=project_id, type="module")
    if not include_archived:
        queryset = queryset.exclude(is_archived=True)
    if uses_manual_module_order(project_id):
        return queryset.order_by(rank_ascending("presentation__rank"), "id")
    return queryset.order_by(*AUTOMATIC_ORDER)


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
        canonical_module_queryset(project_id)
        .values_list("presentation__rank", flat=True)
        .first()
    )
    return key_between(None, first_rank or None)
