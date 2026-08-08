import pytest

from worktracker.tests.factories import ensure_issue


@pytest.fixture(autouse=True)
def seeded_agent_run_issues(request):
    """Seed the deterministic Issue FKs used by run fixtures."""

    if request.node.get_closest_marker("django_db") is None:
        return
    for project_id, module_id, task_ids in (
        ("proj-1", "mod-1", ("task-1", "task-2", "t1", "t2", "t3")),
        ("proj-1", "mod-2", ()),
        ("proj-2", "mod-1", ("task-1",)),
    ):
        ensure_issue(project_id=project_id, module_id=module_id, task_id=None)
        for task_id in task_ids:
            ensure_issue(
                project_id=project_id, module_id=module_id, task_id=task_id
            )
