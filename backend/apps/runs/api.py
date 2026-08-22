"""Read-only Runs projections still served by the supervised sidecar."""

from apps.runs import dao


async def get_module_activity(
    project_id: str,
    window_days: int = dao.DEFAULT_ACTIVITY_WINDOW_DAYS,
):
    """Return the most recent agent interaction per module (#598).

    Backs the frontend's recency sort of the module list. Modules with no
    qualifying run within the window are simply absent from the map.

    :param project_id: scope the activity query to one project.
    :param window_days: lookback cap in days; older runs are excluded.
    :return: a ``{module_id: iso8601}`` map.
    """

    return await dao.last_activity_by_module(project_id, window_days=window_days)
