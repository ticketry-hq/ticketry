from dataclasses import replace

from apps.execution.reducer import decide
from apps.execution.state import EngineState, SeamEvent


def _state(status="idle"):
    return EngineState(
        task_id="task-1",
        project_id="project-1",
        module_id="module-1",
        agent="codex",
        status=status,
    )


def _refine_state(status="idle"):
    return EngineState(
        task_id="task-1",
        project_id="project-1",
        module_id="module-1",
        agent="codex",
        phase="refine",
        status=status,
    )


def _split_state(status="idle"):
    return EngineState(
        task_id="task-1",
        project_id="project-1",
        module_id="module-1",
        agent="codex",
        phase="split",
        status=status,
    )


def _register_state(status="idle"):
    return EngineState(
        task_id="task-1",
        project_id="project-1",
        module_id="module-1",
        agent="codex",
        phase="register",
        status=status,
    )


def _lld_state(status="idle"):
    return EngineState(
        task_id="task-1",
        project_id="project-1",
        module_id="module-1",
        agent="codex",
        phase="lld",
        status=status,
    )


def test_execute_requested_from_idle_produces_launch_action():
    decision = decide(
        _state(),
        SeamEvent(kind="execute_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert len(decision.actions) == 1
    action = decision.actions[0]
    assert action.task_id == "task-1"
    assert action.project_id == "project-1"
    assert action.module_id == "module-1"
    assert action.agent == "codex"
    assert action.recipe == "implement"


def test_execute_requested_for_refine_produces_refine_launch_action():
    decision = decide(
        _refine_state(),
        SeamEvent(kind="execute_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert len(decision.actions) == 1
    assert decision.actions[0].recipe == "refine"


def test_execute_requested_for_split_produces_split_launch_action():
    decision = decide(
        _split_state(),
        SeamEvent(kind="execute_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert len(decision.actions) == 1
    assert decision.actions[0].recipe == "split"


def test_execute_requested_for_register_produces_register_launch_action():
    decision = decide(
        _register_state(),
        SeamEvent(kind="execute_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert len(decision.actions) == 1
    assert decision.actions[0].recipe == "register"


def test_execute_requested_for_lld_produces_lld_launch_action():
    decision = decide(
        _lld_state(),
        SeamEvent(kind="execute_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert len(decision.actions) == 1
    assert decision.actions[0].recipe == "lld"


def test_lld_has_no_completion_gate_and_stays_running():
    running = _lld_state(status="running")

    completed = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            to_group="completed",
        ),
    )
    assert completed.next == running


def test_register_has_no_completion_gate_and_stays_running():
    running = _register_state(status="running")

    completed = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            to_group="completed",
        ),
    )

    assert completed.next == running


def test_split_completes_on_visible_unstarted_workflow_transition():
    running = _split_state(status="running")

    completed = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            from_group="unstarted",
            to_group="unstarted",
        ),
    )

    assert completed.next.status == "done"


def test_run_started_records_run_id_and_marks_running():
    decision = decide(
        _state(),
        SeamEvent(kind="run_started", task_id="task-1", agent_run_id="run-1"),
    )

    assert decision.next.status == "running"
    assert decision.next.agent_run_id == "run-1"
    assert decision.next.error is None


def test_run_failed_records_error_and_marks_failed():
    decision = decide(
        _state(),
        SeamEvent(kind="run_failed", task_id="task-1", error="boom"),
    )

    assert decision.next.status == "failed"
    assert decision.next.error == "boom"
    assert decision.next.agent_run_id is None


def test_matching_completed_event_marks_running_state_done():
    decision = decide(
        _state(status="running"),
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            to_group="completed",
        ),
    )

    assert decision.next.status == "done"


def test_matching_backlog_to_unstarted_event_marks_refine_done():
    decision = decide(
        _refine_state(status="running"),
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            from_group="backlog",
            to_group="unstarted",
        ),
    )

    assert decision.next.status == "done"


def test_unrelated_or_non_completed_issue_state_events_are_ignored():
    running = _state(status="running")

    unrelated = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="other-task",
            to_group="completed",
        ),
    )
    started = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            to_group="started",
        ),
    )

    assert unrelated.next == running
    assert started.next == running


def test_refine_ignores_non_matching_issue_state_events():
    running = _refine_state(status="running")

    unrelated = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="other-task",
            from_group="backlog",
            to_group="unstarted",
        ),
    )
    wrong_destination = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            from_group="backlog",
            to_group="started",
        ),
    )
    wrong_source = decide(
        running,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            from_group="started",
            to_group="unstarted",
        ),
    )

    assert unrelated.next == running
    assert wrong_destination.next == running
    assert wrong_source.next == running


def test_completion_after_done_stays_done():
    done = _refine_state(status="done")

    decision = decide(
        done,
        SeamEvent(
            kind="issue_state_changed",
            task_id="task-1",
            from_group="backlog",
            to_group="unstarted",
        ),
    )

    assert decision.next == done


def test_release_running_run_clears_guard():
    running = replace(_refine_state(status="running"), agent_run_id="run-1")

    decision = decide(
        running,
        SeamEvent(kind="release_requested", task_id="task-1"),
    )

    assert decision.next.status == "idle"
    assert decision.next.agent_run_id is None
    assert decision.next.error is None
    assert decision.actions == []


def test_release_non_running_run_is_noop():
    for status in ("idle", "done", "failed", "halted"):
        state = _refine_state(status=status)

        decision = decide(
            state,
            SeamEvent(kind="release_requested", task_id="task-1"),
        )

        assert decision.next == state


def test_release_for_other_task_is_noop():
    running = _refine_state(status="running")

    decision = decide(
        running,
        SeamEvent(kind="release_requested", task_id="other-task"),
    )

    assert decision.next == running
