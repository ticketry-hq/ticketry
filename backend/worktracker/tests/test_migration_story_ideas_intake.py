import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0039_issue_type_pathfind_role"
AFTER = "0040_story_ideas_intake"


def _project(apps, *, slug):
    Workspace = apps.get_model(APP, "Workspace")
    Project = apps.get_model(APP, "Project")
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug=f"{slug}-workspace",
        name=f"{slug} workspace",
    )
    return Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        slug=slug,
        name=slug,
    )


@pytest.mark.django_db(transaction=True)
def test_migration_adds_ideas_as_story_start_and_grill_return_state():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    State = old.get_model(APP, "State")
    IssueType = old.get_model(APP, "IssueType")
    IssueTypeTransition = old.get_model(APP, "IssueTypeTransition")
    project = _project(old, slug="ideas-intake")
    states = {}
    for sort_order, (name, group) in enumerate(
        (
            ("Grill", "backlog"),
            ("Spec", "unstarted"),
            ("Tickets", "unstarted"),
            ("Implement", "started"),
            ("Review", "started"),
            ("Done", "completed"),
            ("Cancelled", "cancelled"),
        )
    ):
        states[name] = State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            sort_order=sort_order,
            is_protected=True,
        )
    types = {}
    for sort_order, (name, start) in enumerate(
        (("Story", "Grill"), ("PathFind", "Spec"), ("Implementation", "Implement"))
    ):
        types[name] = IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            level="task",
            sort_order=sort_order,
            start_state=states[start],
            workflow_revision=1,
        )
    IssueTypeTransition.objects.create(
        issue_type=types["Story"],
        from_state=states["Grill"],
        to_state=states["Spec"],
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    MigratedState = new.get_model(APP, "State")
    MigratedIssueType = new.get_model(APP, "IssueType")
    MigratedTransition = new.get_model(APP, "IssueTypeTransition")
    MigratedBinding = new.get_model(APP, "LaunchBinding")
    ideas = MigratedState.objects.get(project_id=project.id, name="Ideas")
    assert (ideas.group, ideas.color, ideas.sort_order, ideas.is_protected) == (
        "backlog",
        "#D12771",
        0,
        True,
    )
    story = MigratedIssueType.objects.get(pk=types["Story"].id)
    assert story.start_state_id == ideas.id
    assert {
        (edge.from_state.name, edge.to_state.name, edge.agent_allowed)
        for edge in MigratedTransition.objects.filter(issue_type_id=story.id)
    }.issuperset(
        {
            ("Ideas", "Grill", True),
            ("Ideas", "Spec", True),
            ("Grill", "Ideas", True),
        }
    )
    bindings = MigratedBinding.objects.filter(state_id=ideas.id)
    assert set(bindings.values_list("issue_type__name", flat=True)) == {
        "Story",
        "PathFind",
        "Implementation",
    }
    assert all(binding.auto_start for binding in bindings)
    assert not any(binding.subtree_run_enabled for binding in bindings)
    assert "This Story is in `Ideas`" in bindings.get(issue_type_id=story.id).prompt


@pytest.mark.django_db(transaction=True)
def test_migration_renames_the_protected_singular_idea_state_in_place():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    old = executor.loader.project_state((APP, BEFORE)).apps

    State = old.get_model(APP, "State")
    Issue = old.get_model(APP, "Issue")
    IssueType = old.get_model(APP, "IssueType")
    LaunchBinding = old.get_model(APP, "LaunchBinding")
    project = _project(old, slug="singular-idea")
    idea = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Idea",
        group="backlog",
        color="#D12771",
        is_protected=True,
    )
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Grill", group="backlog"
    )
    State.objects.create(
        id=uuid.uuid4(), project=project, name="Spec", group="unstarted"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=idea,
        workflow_revision=1,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=story,
        type="task",
        state=idea,
        sequence_id=1,
        name="Captured thought",
    )
    binding = LaunchBinding.objects.create(
        issue_type=story,
        state=idea,
        prompt="Keep this custom intake prompt.",
        auto_start=True,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps

    MigratedState = new.get_model(APP, "State")
    MigratedIssue = new.get_model(APP, "Issue")
    MigratedBinding = new.get_model(APP, "LaunchBinding")
    renamed = MigratedState.objects.get(pk=idea.id)
    assert renamed.name == "Ideas"
    assert MigratedIssue.objects.get(pk=issue.id).state_id == renamed.id
    migrated_binding = MigratedBinding.objects.get(pk=binding.id)
    assert migrated_binding.state_id == renamed.id
    assert migrated_binding.prompt == "Keep this custom intake prompt."
