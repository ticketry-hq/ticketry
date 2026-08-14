import json
import uuid

import pytest

from apps.settings_store.profile_prompt_migration import migrate_profile_prompts
from worktracker.models import IssueType, LaunchBinding, Project, State, Workspace
from worktracker.launch_seeds import default_agent_prompt


@pytest.mark.django_db
def test_legacy_profile_prompts_move_to_existing_known_project_bindings(tmp_path):
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    incident = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Incident", level="task"
    )
    grill = State.objects.create(
        id=uuid.uuid4(), project=project, name="Grill", group="backlog"
    )
    implement = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    # Seeded, unedited bindings: the migration only moves a profile prompt onto
    # a binding whose text still matches its seed.
    story_grill = LaunchBinding.objects.create(
        issue_type=story, state=grill, prompt=default_agent_prompt("Story", "Grill")
    )
    story_implement = LaunchBinding.objects.create(
        issue_type=story,
        state=implement,
        prompt=default_agent_prompt("Story", "Implement"),
    )
    custom = LaunchBinding.objects.create(
        issue_type=incident, state=implement, prompt="Incident-specific"
    )
    config_file = tmp_path / "profiles.json"
    config_file.write_text(
        json.dumps(
            {
                "recent_profile_index": 0,
                "profiles": [
                    {
                        "name": "Local",
                        "workspace_slug": "meml",
                        "agent_prompt": "Profile default",
                        "agent_prompts": {"implement": "Profile implement"},
                        "module_links": [],
                    }
                ],
            }
        )
    )

    migrated = migrate_profile_prompts(
        config_file, Workspace=Workspace, LaunchBinding=LaunchBinding
    )

    story_grill.refresh_from_db()
    story_implement.refresh_from_db()
    custom.refresh_from_db()
    assert migrated == 2
    assert story_grill.prompt == "Profile default"
    assert story_implement.prompt == "Profile implement"
    assert custom.prompt == "Incident-specific"
    profile = json.loads(config_file.read_text())["profiles"][0]
    assert "agent_prompt" not in profile
    assert "agent_prompts" not in profile


@pytest.mark.django_db
def test_profile_migration_preserves_project_edited_binding(tmp_path):
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    idea = State.objects.create(
        id=uuid.uuid4(), project=project, name="Idea", group="backlog"
    )
    binding = LaunchBinding.objects.create(
        issue_type=story, state=idea, prompt="Project-owned prompt"
    )
    config_file = tmp_path / "profiles.json"
    config_file.write_text(
        json.dumps(
            {
                "profiles": [
                    {
                        "workspace_slug": "meml",
                        "agent_prompt": "Legacy profile prompt",
                        "agent_prompts": {},
                    }
                ]
            }
        )
    )

    migrated = migrate_profile_prompts(
        config_file, Workspace=Workspace, LaunchBinding=LaunchBinding
    )

    binding.refresh_from_db()
    assert migrated == 0
    assert binding.prompt == "Project-owned prompt"
