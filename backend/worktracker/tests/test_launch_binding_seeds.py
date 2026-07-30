import pytest

from worktracker.launch_seeds import (
    DEFAULT_AGENT_PROMPTS,
    DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE,
)
from worktracker.models import IssueType, LaunchBinding, State
from worktracker.services.projects import create_project


@pytest.mark.django_db
def test_new_project_seeds_known_bindings_as_explicit_rows_and_nothing_wildcard(
    project,
):
    created = create_project(
        name="Seeded",
        slug="seeded",
        workspace_slug=project.workspace.slug,
    )
    story = IssueType.objects.get(project=created, name="Story")
    implement = State.objects.get(project=created, name="Implement")
    seeded = LaunchBinding.objects.get(issue_type=story, state=implement)
    grill = LaunchBinding.objects.get(
        issue_type=story,
        state__name="Grill",
    )
    spec = LaunchBinding.objects.get(
        issue_type=story,
        state__name="Spec",
    )
    tickets = LaunchBinding.objects.get(
        issue_type=story,
        state__name="Tickets",
    )

    assert seeded.prompt == DEFAULT_AGENT_PROMPTS["Implement"]
    assert seeded.agent is None
    assert seeded.model is None
    assert seeded.reasoning is None
    assert seeded.subtree_run_enabled is True
    assert grill.required_skills == ["grill-with-docs"]
    assert grill.auto_start is False
    assert spec.required_skills == ["to-spec"]
    assert spec.auto_start is True
    assert tickets.required_skills == ["to-tickets"]
    assert tickets.auto_start is True
    assert "grill-with-docs" in grill.prompt
    assert "to-spec" not in grill.prompt
    assert "to-tickets" not in grill.prompt

    implementation = IssueType.objects.get(project=created, name="Implementation")
    story_implement = LaunchBinding.objects.get(
        issue_type=story,
        state=implement,
    )
    implementation_implement = LaunchBinding.objects.get(
        issue_type=implementation,
        state=implement,
    )
    assert story_implement.prompt == DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE["Story"][
        "Implement"
    ]
    assert implementation_implement.prompt == (
        DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE["Implementation"]["Implement"]
    )
    assert story_implement.prompt != implementation_implement.prompt

    other_seeded = LaunchBinding.objects.exclude(issue_type=story)
    assert other_seeded.exists()
    assert not other_seeded.filter(subtree_run_enabled=True).exists()

    custom_type = IssueType.objects.create(
        id=story.id.__class__("00000000-0000-0000-0000-000000000123"),
        project=created,
        name="Incident",
        level="task",
    )
    custom_state = State.objects.create(
        id=implement.id.__class__("00000000-0000-0000-0000-000000000124"),
        project=created,
        name="Mitigating",
        group="started",
    )

    assert not LaunchBinding.objects.filter(issue_type=custom_type).exists()
    assert not LaunchBinding.objects.filter(state=custom_state).exists()
