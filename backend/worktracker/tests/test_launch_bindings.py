import uuid

import pytest
from django.core.exceptions import ValidationError

from worktracker.models import Issue, IssueType, LaunchBinding, State
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    get_launch_binding,
    resolve_issue_launch_binding,
    validate_provider_options,
    validate_unattended_launch_binding,
)
from worktracker.services.errors import ValidationError as ServiceValidationError
from worktracker.services.scoped_workflows import upsert_launch_binding


@pytest.fixture
def launch_policy(project):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Build", group="started"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Change", level="task"
    )
    return issue_type, state


@pytest.mark.django_db
def test_upsert_preserves_required_skill_order_and_rejects_invalid_catalog_entries(
    project, launch_policy
):
    issue_type, state = launch_policy
    upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="Refine the work",
        agent="codex",
        model=None,
        reasoning=None,
        workflow_revision=issue_type.workflow_revision,
        required_skills=["to-tickets", "grill-with-docs", "to-spec"],
    )
    binding = LaunchBinding.objects.get(issue_type=issue_type, state=state)

    assert binding.required_skills == [
        "to-tickets",
        "grill-with-docs",
        "to-spec",
    ]

    issue_type.refresh_from_db()
    with pytest.raises(LaunchBindingError) as exc:
        upsert_launch_binding(
            issue_type.id,
            state.id,
            prompt="Refine the work",
            agent="codex",
            model=None,
            reasoning=None,
            workflow_revision=issue_type.workflow_revision,
            required_skills=["not-in-the-pinned-snapshot"],
        )
    assert exc.value.code == "invalid_required_skills"
    assert exc.value.field == "required_skills"


@pytest.mark.django_db
def test_required_skills_need_a_non_empty_prompt(project, launch_policy):
    issue_type, state = launch_policy

    with pytest.raises(LaunchBindingError) as exc:
        upsert_launch_binding(
            issue_type.id,
            state.id,
            prompt=" ",
            agent="codex",
            model=None,
            reasoning=None,
            workflow_revision=issue_type.workflow_revision,
            required_skills=["to-spec"],
        )

    assert exc.value.code == "prompt_required_for_skills"
    assert exc.value.field == "prompt"


@pytest.mark.django_db
def test_resolution_uses_type_and_current_state_not_structural_parent_depth(
    project, launch_policy
):
    issue_type, state = launch_policy
    upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="Build it",
        agent="codex",
        model=None,
        reasoning=None,
        workflow_revision=issue_type.workflow_revision,
    )
    binding = LaunchBinding.objects.get(issue_type=issue_type, state=state)
    parent = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Parent",
        sequence_id=1,
        issue_type=issue_type,
        state=state,
    )
    child = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Child",
        sequence_id=2,
        issue_type=issue_type,
        state=state,
        parent=parent,
    )

    assert resolve_issue_launch_binding(parent).id == binding.id
    assert resolve_issue_launch_binding(child).id == binding.id


@pytest.mark.django_db
def test_unconfigured_custom_type_or_state_gets_no_invented_binding(
    project, launch_policy
):
    issue_type, state = launch_policy
    custom_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Incident", level="task"
    )
    custom_state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Mitigating", group="started"
    )

    assert get_launch_binding(custom_type.id, state.id) is None
    assert get_launch_binding(issue_type.id, custom_state.id) is None


@pytest.mark.django_db
def test_binding_without_prompt_is_not_launchable(project, launch_policy):
    issue_type, state = launch_policy
    upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="  ",
        agent="codex",
        model=None,
        reasoning=None,
        workflow_revision=issue_type.workflow_revision,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="Promptless",
        sequence_id=1,
        issue_type=issue_type,
        state=state,
    )

    with pytest.raises(LaunchBindingError) as exc:
        resolve_issue_launch_binding(issue)

    assert exc.value.code == "prompt_not_configured"
    assert "prompt" in exc.value.message.lower()


@pytest.mark.django_db
def test_provider_reasoning_incompatibility_is_clear(project, launch_policy):
    issue_type, state = launch_policy

    with pytest.raises(LaunchBindingError) as exc:
        upsert_launch_binding(
            issue_type.id,
            state.id,
            prompt="Investigate",
            agent="gemini",
            model="gemini-3.1-pro-preview",
            reasoning="high",
            workflow_revision=issue_type.workflow_revision,
        )

    assert exc.value.code == "unsupported_reasoning"
    assert exc.value.field == "reasoning"
    assert "gemini" in exc.value.message


@pytest.mark.django_db
def test_provider_model_incompatibility_is_clear(project, launch_policy):
    issue_type, state = launch_policy

    with pytest.raises(LaunchBindingError) as exc:
        upsert_launch_binding(
            issue_type.id,
            state.id,
            prompt="Investigate",
            agent="gemini",
            model="gpt-5.4",
            reasoning=None,
            workflow_revision=issue_type.workflow_revision,
        )

    assert exc.value.code == "unsupported_model"
    assert exc.value.field == "model"
    assert "gpt-5.4" in exc.value.message
    assert "gemini" in exc.value.message


@pytest.mark.django_db
def test_provider_validation_rejects_a_deactivated_provider():
    from worktracker.models import Provider

    Provider.objects.filter(slug="codex").update(activated=False)

    with pytest.raises(LaunchBindingError) as exc:
        validate_provider_options(agent="codex", model="gpt-5.4", reasoning="high")

    assert exc.value.code == "provider_not_activated"
    assert exc.value.field == "agent"
    assert "codex" in exc.value.message


@pytest.mark.django_db
def test_unattended_launch_accepts_a_blank_binding_backed_by_the_global_default(
    project, launch_policy
):
    from apps.settings_store.models import AppSetting

    issue_type, state = launch_policy
    AppSetting.objects.create(
        scope="host",
        key="provider_catalog",
        value='{"global_default":{"provider":"codex","model":"gpt-5.4"}}',
        updated_at="2026-07-27T00:00:00+00:00",
    )
    binding = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=state,
        prompt="Automate this",
        agent=None,
        model=None,
        reasoning=None,
    )

    assert validate_unattended_launch_binding(binding) is binding


@pytest.mark.django_db
def test_unattended_launch_refuses_a_blank_binding_without_a_global_default(
    project, launch_policy
):
    issue_type, state = launch_policy
    binding = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=state,
        prompt="Automate this",
        agent=None,
        model=None,
        reasoning=None,
    )

    with pytest.raises(LaunchBindingError) as exc:
        validate_unattended_launch_binding(binding)

    assert exc.value.code == "agent_not_configured"


@pytest.mark.django_db
def test_binding_rejects_cross_project_type_state_pair(project, launch_policy):
    issue_type, _ = launch_policy
    other_project = project.__class__.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="Other",
        slug="other",
    )
    foreign_state = State.objects.create(
        id=uuid.uuid4(), project=other_project, name="Build", group="started"
    )

    with pytest.raises(ServiceValidationError) as exc:
        upsert_launch_binding(
            issue_type.id,
            foreign_state.id,
            prompt="Nope",
            agent="codex",
            model=None,
            reasoning=None,
            workflow_revision=issue_type.workflow_revision,
        )

    assert exc.value.message == "State does not belong to this project."


@pytest.mark.django_db
def test_model_validation_protects_admin_and_other_direct_writes(
    project, launch_policy
):
    issue_type, state = launch_policy
    other_project = project.__class__.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="Other direct",
        slug="other-direct",
    )
    foreign_state = State.objects.create(
        id=uuid.uuid4(), project=other_project, name="Build", group="started"
    )

    cross_project = LaunchBinding(
        issue_type=issue_type,
        state=foreign_state,
        prompt="Nope",
        agent="codex",
    )
    with pytest.raises(ValidationError) as exc:
        cross_project.full_clean()
    assert "state" in exc.value.message_dict

    invalid_provider_options = LaunchBinding(
        issue_type=issue_type,
        state=state,
        prompt="Nope",
        agent="gemini",
        model="gpt-5.4",
    )
    with pytest.raises(ValidationError) as exc:
        invalid_provider_options.full_clean()
    assert "model" in exc.value.message_dict

    invalid_required_skills = LaunchBinding(
        issue_type=issue_type,
        state=state,
        prompt="Nope",
        required_skills=["to-spec", "to-spec"],
    )
    with pytest.raises(ValidationError) as exc:
        invalid_required_skills.full_clean()
    assert "required_skills" in exc.value.message_dict
