import importlib
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from worktracker.launch_seeds import (
    DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE,
    DEFAULT_AUTO_START_BY_STATE,
)
from worktracker.models import DEFAULT_STATES
from worktracker.required_skills import DEFAULT_REQUIRED_SKILLS
from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES


APP = "worktracker"
BEFORE = "0029_sync_reviewed_launch_prompts"
AFTER = "0030_migrate_matt_style_workflow"
MIGRATION = importlib.import_module(
    "worktracker.migrations.0030_migrate_matt_style_workflow"
)


def _issue(Issue, *, project, issue_type, state, sequence_id):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=issue_type,
        type="task",
        state=state,
        sequence_id=sequence_id,
        name=f"Issue {sequence_id}",
    )


@pytest.mark.django_db(transaction=True)
def test_migration_upgrades_existing_projects_in_place_and_preserves_customizations():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    Workspace = old.get_model(APP, "Workspace")
    Project = old.get_model(APP, "Project")
    Issue = old.get_model(APP, "Issue")
    IssueType = old.get_model(APP, "IssueType")
    State = old.get_model(APP, "State")
    IssueTypeTransition = old.get_model(APP, "IssueTypeTransition")
    LaunchBinding = old.get_model(APP, "LaunchBinding")

    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="matt-migration",
        name="Matt migration",
    )
    project = Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name="Existing",
        slug="EXISTING",
    )
    old_state_rows = {}
    for sort_order, (name, group, color) in enumerate(
        (
            ("Idea", "backlog", "#60646C"),
            ("Refinement", "unstarted", "#8E4EC6"),
            ("Ready", "unstarted", "#0091FF"),
            ("Implement", "started", "#F59E0B"),
            ("Review", "started", "#D6409F"),
            ("Done", "completed", "#46A758"),
            ("Cancelled", "cancelled", "#9AA4BC"),
        )
    ):
        old_state_rows[name] = State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            color=color,
            sort_order=sort_order,
        )
    custom_state = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Deploy",
        group="started",
        color="#123456",
        sort_order=42,
        is_protected=False,
    )
    custom_state_snapshot = (
        custom_state.name,
        custom_state.group,
        custom_state.color,
        custom_state.sort_order,
        custom_state.is_protected,
    )

    types = {}
    for sort_order, (name, start_name) in enumerate(
        (
            ("Story", "Idea"),
            ("PathFind", "Refinement"),
            ("Implementation", "Implement"),
        )
    ):
        types[name] = IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            level="task",
            sort_order=sort_order,
            start_state=old_state_rows[start_name],
            workflow_revision=4,
        )
    custom_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Incident",
        level="task",
        sort_order=9,
        start_state=custom_state,
        workflow_revision=7,
    )

    classic_edges = {
        "Story": (
            ("Idea", "Refinement"),
            ("Idea", "Cancelled"),
            ("Refinement", "Ready"),
            ("Refinement", "Cancelled"),
            ("Ready", "Implement"),
            ("Ready", "Cancelled"),
            ("Implement", "Review"),
            ("Implement", "Cancelled"),
            ("Review", "Implement"),
            ("Review", "Done"),
            ("Review", "Cancelled"),
        ),
        "PathFind": (
            ("Refinement", "Done"),
            ("Refinement", "Cancelled"),
        ),
        "Implementation": (
            ("Ready", "Implement"),
            ("Ready", "Cancelled"),
            ("Implement", "Review"),
            ("Implement", "Cancelled"),
            ("Review", "Implement"),
            ("Review", "Done"),
            ("Review", "Cancelled"),
        ),
    }
    for type_name, edges in classic_edges.items():
        IssueTypeTransition.objects.bulk_create(
            IssueTypeTransition(
                issue_type=types[type_name],
                from_state=old_state_rows[source],
                to_state=old_state_rows[target],
            )
            for source, target in edges
        )
    custom_story_edge = IssueTypeTransition.objects.create(
        issue_type=types["Story"],
        from_state=old_state_rows["Review"],
        to_state=custom_state,
        agent_allowed=False,
    )
    custom_type_edge = IssueTypeTransition.objects.create(
        issue_type=custom_type,
        from_state=custom_state,
        to_state=old_state_rows["Done"],
        agent_allowed=False,
    )

    custom_prompt = (
        MIGRATION.PREVIOUS_DEFAULT_PROMPTS_BY_STATE["Spec"] + "\nKeep my edit."
    )
    for issue_type in types.values():
        for state_name, state in old_state_rows.items():
            current_name = {
                "Idea": "Grill",
                "Refinement": "Spec",
            }.get(state_name, state_name)
            previous_prompt = MIGRATION.PREVIOUS_DEFAULT_PROMPTS_BY_STATE.get(
                current_name,
                "Ready prompt that will be deleted",
            )
            if issue_type.name == "Implementation" and state_name == "Refinement":
                previous_prompt = custom_prompt
            LaunchBinding.objects.create(
                issue_type=issue_type,
                state=state,
                prompt=previous_prompt,
                required_skills=["old-skill"],
                auto_start=True,
                subtree_run_enabled=False,
            )
    custom_binding = LaunchBinding.objects.create(
        issue_type=custom_type,
        state=custom_state,
        prompt="Custom binding",
        required_skills=["custom-skill"],
        agent="custom-agent",
        auto_start=True,
        subtree_run_enabled=True,
    )

    idea_issue = _issue(
        Issue,
        project=project,
        issue_type=types["Story"],
        state=old_state_rows["Idea"],
        sequence_id=1,
    )
    refinement_issue = _issue(
        Issue,
        project=project,
        issue_type=types["PathFind"],
        state=old_state_rows["Refinement"],
        sequence_id=2,
    )
    ready_issue = _issue(
        Issue,
        project=project,
        issue_type=types["Implementation"],
        state=old_state_rows["Ready"],
        sequence_id=3,
    )
    custom_issue = _issue(
        Issue,
        project=project,
        issue_type=custom_type,
        state=custom_state,
        sequence_id=4,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    MigratedIssue = new.get_model(APP, "Issue")
    MigratedIssueType = new.get_model(APP, "IssueType")
    MigratedState = new.get_model(APP, "State")
    MigratedTransition = new.get_model(APP, "IssueTypeTransition")
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    canonical_states = list(
        MigratedState.objects.filter(
            project_id=project.id,
            name__in=[name for name, _group, _color in DEFAULT_STATES],
        ).order_by("sort_order")
    )
    assert [
        (state.name, state.group, state.color, state.is_protected)
        for state in canonical_states
    ] == [
        (name, group, color, True) for name, group, color in DEFAULT_STATES
    ]
    assert not MigratedState.objects.filter(
        project_id=project.id,
        name="Ready",
    ).exists()
    states = {state.name: state for state in canonical_states}
    assert states["Grill"].id == old_state_rows["Idea"].id
    assert states["Spec"].id == old_state_rows["Refinement"].id
    assert MigratedIssue.objects.get(pk=idea_issue.id).state_id == states["Grill"].id
    assert (
        MigratedIssue.objects.get(pk=refinement_issue.id).state_id
        == states["Spec"].id
    )
    assert (
        MigratedIssue.objects.get(pk=ready_issue.id).state_id
        == states["Implement"].id
    )
    assert MigratedIssue.objects.get(pk=custom_issue.id).state_id == custom_state.id
    migrated_custom_state = MigratedState.objects.get(pk=custom_state.id)
    assert (
        migrated_custom_state.name,
        migrated_custom_state.group,
        migrated_custom_state.color,
        migrated_custom_state.sort_order,
        migrated_custom_state.is_protected,
    ) == custom_state_snapshot

    canonical_state_ids = {state.id for state in canonical_states}
    for type_name, template in DEFAULT_WORKFLOW_TEMPLATES.items():
        issue_type = MigratedIssueType.objects.get(pk=types[type_name].id)
        assert issue_type.start_state_id == states[template["start"]].id
        actual_edges = {
            (
                edge.from_state.name,
                edge.to_state.name,
                edge.agent_allowed,
            )
            for edge in MigratedTransition.objects.filter(
                issue_type_id=issue_type.id,
                from_state_id__in=canonical_state_ids,
                to_state_id__in=canonical_state_ids,
            ).select_related("from_state", "to_state")
        }
        expected_edges = {
            (
                source,
                target,
                template["agent_allowed"].get((source, target), True),
            )
            for source, targets in template["transitions"].items()
            for target in targets
        }
        assert actual_edges == expected_edges

    assert MigratedTransition.objects.filter(pk=custom_story_edge.id).exists()
    assert MigratedTransition.objects.filter(pk=custom_type_edge.id).exists()
    migrated_custom_type = MigratedIssueType.objects.get(pk=custom_type.id)
    assert migrated_custom_type.start_state_id == custom_state.id
    assert migrated_custom_type.workflow_revision == 7

    bindings = MigratedBinding.objects.filter(
        issue_type_id__in=[issue_type.id for issue_type in types.values()],
        state_id__in=canonical_state_ids,
    ).select_related("issue_type", "state")
    assert bindings.count() == len(types) * len(DEFAULT_STATES)
    for binding in bindings:
        state_name = binding.state.name
        assert binding.required_skills == list(
            DEFAULT_REQUIRED_SKILLS.get(state_name, ())
        )
        assert binding.auto_start is DEFAULT_AUTO_START_BY_STATE[state_name]
        assert binding.subtree_run_enabled is (
            binding.issue_type.name == "Story"
        )
        if (
            binding.issue_type.name == "Implementation"
            and state_name == "Spec"
        ):
            assert binding.prompt == custom_prompt
        else:
            assert binding.prompt == DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE[
                binding.issue_type.name
            ][state_name]

    migrated_custom_binding = MigratedBinding.objects.get(pk=custom_binding.id)
    assert migrated_custom_binding.prompt == "Custom binding"
    assert migrated_custom_binding.required_skills == ["custom-skill"]
    assert migrated_custom_binding.agent == "custom-agent"
    assert migrated_custom_binding.auto_start is True
    assert migrated_custom_binding.subtree_run_enabled is True

    before_replay = {
        "states": list(
            MigratedState.objects.filter(project_id=project.id)
            .order_by("id")
            .values_list("id", "name", "group", "color", "sort_order")
        ),
        "transitions": list(
            MigratedTransition.objects.filter(issue_type__project_id=project.id)
            .order_by("id")
            .values_list(
                "id",
                "issue_type_id",
                "from_state_id",
                "to_state_id",
                "agent_allowed",
            )
        ),
        "bindings": list(
            MigratedBinding.objects.filter(issue_type__project_id=project.id)
            .order_by("id")
            .values_list(
                "id",
                "issue_type_id",
                "state_id",
                "prompt",
                "required_skills",
                "auto_start",
                "subtree_run_enabled",
            )
        ),
    }
    MIGRATION.migrate_matt_style_workflow(new, None)
    after_replay = {
        "states": list(
            MigratedState.objects.filter(project_id=project.id)
            .order_by("id")
            .values_list("id", "name", "group", "color", "sort_order")
        ),
        "transitions": list(
            MigratedTransition.objects.filter(issue_type__project_id=project.id)
            .order_by("id")
            .values_list(
                "id",
                "issue_type_id",
                "from_state_id",
                "to_state_id",
                "agent_allowed",
            )
        ),
        "bindings": list(
            MigratedBinding.objects.filter(issue_type__project_id=project.id)
            .order_by("id")
            .values_list(
                "id",
                "issue_type_id",
                "state_id",
                "prompt",
                "required_skills",
                "auto_start",
                "subtree_run_enabled",
            )
        ),
    }
    assert after_replay == before_replay

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
