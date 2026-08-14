import uuid

import pytest
from django.core.exceptions import ValidationError

from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    LaunchBinding,
    Provider,
    ReasoningLevel,
    State,
)
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    get_launch_binding,
    resolve_issue_launch_binding,
    validate_provider_options,
    validate_unattended_launch_binding,
)


@pytest.fixture
def launch_policy(project):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Build", group="started"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Change", level="task"
    )
    return issue_type, state


def _save_binding(issue_type, state, **values):
    binding = LaunchBinding(issue_type=issue_type, state=state, **values)
    binding.full_clean()
    binding.save()
    return binding


@pytest.mark.django_db
def test_binding_preserves_required_skill_order_and_rejects_invalid_catalog_entries(
    project, launch_policy
):
    issue_type, state = launch_policy
    binding = _save_binding(
        issue_type,
        state,
        prompt="Refine the work",
        required_skills=["to-tickets", "grill-with-docs", "to-spec"],
    )

    assert binding.required_skills == [
        "to-tickets",
        "grill-with-docs",
        "to-spec",
    ]

    with pytest.raises(ValidationError) as exc:
        _save_binding(
            issue_type,
            state,
            prompt="Refine the work",
            required_skills=["not-in-the-pinned-snapshot"],
        )
    assert "required_skills" in exc.value.message_dict


@pytest.mark.django_db
def test_required_skills_need_a_non_empty_prompt(project, launch_policy):
    issue_type, state = launch_policy

    with pytest.raises(ValidationError) as exc:
        _save_binding(
            issue_type,
            state,
            prompt=" ",
            required_skills=["to-spec"],
        )

    assert "prompt" in exc.value.message_dict


@pytest.mark.django_db
def test_resolution_uses_type_and_current_state_not_structural_parent_depth(
    project, launch_policy
):
    issue_type, state = launch_policy
    binding = _save_binding(
        issue_type,
        state,
        prompt="Build it",
    )
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
    model = AgentModel.objects.get(
        provider=Provider.objects.get(slug="codex"), name="gpt-5.4"
    )
    _save_binding(
        issue_type,
        state,
        prompt="  ",
        model=model,
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
    AgentModel.objects.get(
        provider=Provider.objects.get(slug="gemini"),
        name="gemini-3.1-pro-preview",
    )
    with pytest.raises(LaunchBindingError) as exc:
        validate_provider_options(
            agent="gemini",
            model="gemini-3.1-pro-preview",
            reasoning="high",
        )

    assert exc.value.code == "unsupported_reasoning"
    assert exc.value.field == "reasoning"
    assert "gemini" in exc.value.message


@pytest.mark.django_db
def test_provider_model_incompatibility_is_clear(project, launch_policy):
    with pytest.raises(LaunchBindingError) as exc:
        validate_provider_options(
            agent="gemini",
            model="gpt-5.4",
            reasoning=None,
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

    with pytest.raises(ValidationError) as exc:
        _save_binding(
            issue_type,
            foreign_state,
            prompt="Nope",
        )

    assert "state" in exc.value.message_dict


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
    )
    with pytest.raises(ValidationError) as exc:
        cross_project.full_clean()
    assert "state" in exc.value.message_dict

    gemini_model = AgentModel.objects.get(
        provider=Provider.objects.get(slug="gemini"),
        name="gemini-3.1-pro-preview",
    )
    high = ReasoningLevel.objects.get(name="high")
    invalid_provider_options = LaunchBinding(
        issue_type=issue_type,
        state=state,
        prompt="Nope",
        model=gemini_model,
        reasoning=high,
    )
    with pytest.raises(ValidationError) as exc:
        invalid_provider_options.full_clean()
    assert "reasoning" in exc.value.message_dict

    invalid_required_skills = LaunchBinding(
        issue_type=issue_type,
        state=state,
        prompt="Nope",
        required_skills=["to-spec", "to-spec"],
    )
    with pytest.raises(ValidationError) as exc:
        invalid_required_skills.full_clean()
    assert "required_skills" in exc.value.message_dict
