import pytest

from worktracker.launch_seeds import DEFAULT_AGENT_PROMPTS
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

    assert seeded.prompt == DEFAULT_AGENT_PROMPTS["Implement"]
    assert seeded.agent is None
    assert seeded.model is None
    assert seeded.reasoning is None
    assert seeded.subtree_run_enabled is True

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
