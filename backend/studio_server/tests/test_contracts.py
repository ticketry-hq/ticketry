from studio_server.contracts import ModuleSummary, TaskState, TaskSummary


def test_shared_task_contracts_are_importable_from_the_server_package():
    task = TaskSummary(
        id="task-1",
        name="Shared contracts",
        project_id="project-1",
        state=TaskState(name="Implement"),
        issue_type="Implementation",
    )

    assert task.state.name == "Implement"
    assert ModuleSummary(id="module-1", name="Core", project_id="project-1").name == "Core"
