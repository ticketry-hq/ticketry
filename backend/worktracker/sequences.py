from django.db import transaction

from worktracker.models import Project


def allocate_sequence_id(project_id):
    """Allocate the next shared sequence id for a project (C5).

    One monotonic, type-agnostic counter feeds every issue create — module
    or task — so ``MEML-1``, ``MEML-2``, ``MEML-3`` never collide. The row is
    locked for the transaction (a true lock on Postgres; on SQLite the lock is
    a no-op but ``atomic()`` + WAL + ``busy_timeout`` serialize writers).

    :param project_id: The project whose counter is incremented.
    :return: The newly allocated sequence id (the ``N`` in ``KEY-N``).
    """

    with transaction.atomic():
        # Lock the project row for the duration of the transaction.

        project = Project.objects.select_for_update().get(pk=project_id)

        project.seq_counter += 1
        project.save(update_fields=["seq_counter"])

        return project.seq_counter
