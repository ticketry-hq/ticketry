import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0041_project_manual_module_order"
AFTER = "0042_merge_singular_idea_state"


def _project(apps):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="idea-merge-workspace",
        name="Idea merge workspace",
    )
    return Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        slug="idea-merge",
        name="Idea merge",
    )


@pytest.mark.django_db(transaction=True)
def test_migration_folds_singular_idea_into_the_default_ideas_state():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    State = old.get_model(APP, "State")
    Issue = old.get_model(APP, "Issue")
    IssueType = old.get_model(APP, "IssueType")
    IssueTypeTransition = old.get_model(APP, "IssueTypeTransition")
    LaunchBinding = old.get_model(APP, "LaunchBinding")
    project = _project(old)
    idea = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Idea",
        group="backlog",
        sort_order=0,
    )
    ideas = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Ideas",
        group="backlog",
        color="#000000",
        sort_order=4,
    )
    grill = State.objects.create(
        id=uuid.uuid4(), project=project, name="Grill", group="backlog"
    )
    spec = State.objects.create(
        id=uuid.uuid4(), project=project, name="Spec", group="unstarted"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=grill,
    )
    custom_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Custom",
        level="task",
        start_state=idea,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=custom_type,
        type="task",
        state=idea,
        sequence_id=1,
        name="Legacy idea",
    )

    IssueTypeTransition.objects.create(
        issue_type=story,
        from_state=ideas,
        to_state=grill,
        agent_allowed=False,
    )
    IssueTypeTransition.objects.create(
        issue_type=story,
        from_state=idea,
        to_state=grill,
        agent_allowed=True,
    )
    IssueTypeTransition.objects.create(
        issue_type=custom_type,
        from_state=spec,
        to_state=idea,
        agent_allowed=False,
    )
    IssueTypeTransition.objects.create(
        issue_type=custom_type,
        from_state=idea,
        to_state=ideas,
    )

    current_binding = LaunchBinding.objects.create(
        issue_type=story,
        state=ideas,
        prompt="Current Ideas policy",
    )
    LaunchBinding.objects.create(
        issue_type=story,
        state=idea,
        prompt="Stale Idea policy",
    )
    moved_binding = LaunchBinding.objects.create(
        issue_type=custom_type,
        state=idea,
        prompt="Custom policy",
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    MigratedState = new.get_model(APP, "State")
    MigratedIssue = new.get_model(APP, "Issue")
    MigratedIssueType = new.get_model(APP, "IssueType")
    MigratedTransition = new.get_model(APP, "IssueTypeTransition")
    MigratedBinding = new.get_model(APP, "LaunchBinding")

    assert not MigratedState.objects.filter(project_id=project.id, name="Idea").exists()
    migrated_ideas = MigratedState.objects.get(pk=ideas.id)
    assert (
        migrated_ideas.name,
        migrated_ideas.group,
        migrated_ideas.color,
        migrated_ideas.sort_order,
        migrated_ideas.is_protected,
    ) == ("Ideas", "backlog", "#D12771", 0, True)
    assert MigratedIssue.objects.get(pk=issue.id).state_id == migrated_ideas.id
    assert (
        MigratedIssueType.objects.get(pk=story.id).start_state_id == migrated_ideas.id
    )
    assert (
        MigratedIssueType.objects.get(pk=custom_type.id).start_state_id
        == migrated_ideas.id
    )

    assert list(
        MigratedTransition.objects.filter(issue_type_id=story.id).values_list(
            "from_state_id", "to_state_id", "agent_allowed"
        )
    ) == [(migrated_ideas.id, grill.id, True)]
    assert list(
        MigratedTransition.objects.filter(issue_type_id=custom_type.id).values_list(
            "from_state_id", "to_state_id", "agent_allowed"
        )
    ) == [(spec.id, migrated_ideas.id, False)]

    preserved = MigratedBinding.objects.get(pk=current_binding.id)
    assert preserved.state_id == migrated_ideas.id
    assert preserved.prompt == "Current Ideas policy"
    moved = MigratedBinding.objects.get(pk=moved_binding.id)
    assert moved.state_id == migrated_ideas.id
    assert moved.prompt == "Custom policy"
    assert MigratedBinding.objects.filter(state_id=migrated_ideas.id).count() == 2
