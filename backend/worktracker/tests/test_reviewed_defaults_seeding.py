import json
import uuid
from importlib.resources import files
from pathlib import Path

import pytest

from worktracker.launch_seeds import DEFAULT_AUTO_START_BY_STATE
from worktracker.models import (
    DEFAULT_ISSUE_TYPES,
    DEFAULT_STATES,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    AgentModel,
    Provider,
    ReasoningLevel,
    State,
    Workspace,
)
from worktracker.seed import ensure_state_order as canonical_state_order
from worktracker.required_skills import DEFAULT_REQUIRED_SKILLS
from worktracker.services.projects import create_project
from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES


REVIEWED_DEFAULTS = json.loads(
    files("worktracker").joinpath("reviewed_defaults.json").read_text(encoding="utf-8")
)


def artifact_workflow_templates():
    templates = {}
    for issue_type in REVIEWED_DEFAULTS["issueTypes"]:
        workflow = REVIEWED_DEFAULTS["workflows"][issue_type]
        transitions = {state_name: [] for state_name in workflow["states"]}
        agent_allowed = {}
        for edge in workflow["transitions"]:
            source, target = edge[:2]
            metadata = edge[2] if len(edge) == 3 else {}
            transitions[source].append(target)
            agent_allowed[(source, target)] = metadata.get("agentAllowed", True)
        templates[issue_type] = {
            "start": workflow["start"],
            "transitions": {
                source: tuple(targets) for source, targets in transitions.items()
            },
            "agent_allowed": agent_allowed,
        }
    return templates


def model_snapshot(instance):
    return {
        field.attname: getattr(instance, field.attname)
        for field in instance._meta.concrete_fields
    }


def test_workflow_templates_preserve_the_artifacts_legacy_seed_shape():
    assert DEFAULT_WORKFLOW_TEMPLATES == artifact_workflow_templates()


def test_artifact_vocabulary_matches_backend_canonical_definitions():
    artifact_states = [
        (state["name"], state["group"], state["color"])
        for state in REVIEWED_DEFAULTS["states"]
    ]
    canonical_task_types = [
        name for name, level in DEFAULT_ISSUE_TYPES if level == "task"
    ]

    assert artifact_states == DEFAULT_STATES
    assert REVIEWED_DEFAULTS["issueTypes"] == canonical_task_types
    assert {
        state_name: list(required_skills)
        for state_name, required_skills in DEFAULT_REQUIRED_SKILLS.items()
    } == REVIEWED_DEFAULTS["requiredSkills"]


def test_artifact_declares_the_matt_style_fresh_project_contract():
    assert [
        (state["name"], state["group"])
        for state in REVIEWED_DEFAULTS["states"]
    ] == [
        ("Ideas", "backlog"),
        ("Grill", "backlog"),
        ("Spec", "unstarted"),
        ("Tickets", "unstarted"),
        ("Implement", "started"),
        ("Review", "started"),
        ("Done", "completed"),
        ("Cancelled", "cancelled"),
    ]
    assert {
        state["name"]: state["autoStart"]
        for state in REVIEWED_DEFAULTS["states"]
    } == {
        "Ideas": True,
        "Grill": False,
        "Spec": True,
        "Tickets": True,
        "Implement": False,
        "Review": False,
        "Done": False,
        "Cancelled": False,
    }
    assert REVIEWED_DEFAULTS["requiredSkills"] == {
        "Ideas": [],
        "Grill": ["grill-with-docs"],
        "Spec": ["to-spec"],
        "Tickets": ["to-tickets"],
        "Implement": [],
        "Review": [],
        "Done": [],
        "Cancelled": [],
    }

    expected_workflows = {
        "Story": {
            "start": "Ideas",
            "states": {
                "Ideas",
                "Grill",
                "Spec",
                "Tickets",
                "Implement",
                "Review",
                "Done",
                "Cancelled",
            },
            "edges": {
                ("Ideas", "Grill", True),
                ("Ideas", "Spec", True),
                ("Ideas", "Implement", True),
                ("Grill", "Ideas", True),
                ("Grill", "Spec", True),
                ("Grill", "Cancelled", True),
                ("Spec", "Tickets", True),
                ("Spec", "Cancelled", True),
                ("Tickets", "Implement", False),
                ("Tickets", "Cancelled", True),
                ("Implement", "Grill", True),
                ("Implement", "Review", True),
                ("Implement", "Cancelled", True),
                ("Review", "Implement", True),
                ("Review", "Done", True),
                ("Review", "Cancelled", True),
            },
        },
        "Implementation": {
            "start": "Implement",
            "states": {"Implement", "Review", "Done", "Cancelled"},
            "edges": {
                ("Implement", "Review", True),
                ("Implement", "Cancelled", True),
                ("Review", "Implement", True),
                ("Review", "Done", True),
                ("Review", "Cancelled", True),
            },
        },
        "PathFind": {
            "start": "Spec",
            "states": {"Spec", "Done", "Cancelled"},
            "edges": {
                ("Spec", "Done", True),
                ("Spec", "Cancelled", True),
            },
        },
    }
    for issue_type, expected in expected_workflows.items():
        workflow = REVIEWED_DEFAULTS["workflows"][issue_type]
        assert workflow["start"] == expected["start"]
        assert set(workflow["states"]) == expected["states"]
        assert {
            (
                edge[0],
                edge[1],
                edge[2].get("agentAllowed", True) if len(edge) == 3 else True,
            )
            for edge in workflow["transitions"]
        } == expected["edges"]

    story_prompts = REVIEWED_DEFAULTS["prompts"]["Story"]
    assert "small, unambiguous, and self-contained" in story_prompts["Ideas"]
    assert "`run_now`" in story_prompts["Ideas"]
    assert "never use a bare state move" in story_prompts["Ideas"]
    assert "`Grill`" in story_prompts["Ideas"]
    assert "`Spec`" in story_prompts["Ideas"]
    assert "Do not implement" in story_prompts["Ideas"]
    assert "$grill-with-docs" in story_prompts["Grill"]
    assert "`Spec`" in story_prompts["Grill"]
    assert "`Tickets`" not in story_prompts["Grill"]
    assert "specification" in story_prompts["Spec"]
    assert "`Tickets`" in story_prompts["Spec"]
    assert "`Implement`" not in story_prompts["Spec"]
    assert "Implementation children" in story_prompts["Tickets"]
    assert "`Implement`" in story_prompts["Tickets"]
    assert "`Spec`" not in story_prompts["Tickets"]
    assert "no Implementation children" in story_prompts["Implement"]
    assert "larger or more ambiguous" in story_prompts["Implement"]
    assert "move the Story to `Grill`" in story_prompts["Implement"]
    for prompts in REVIEWED_DEFAULTS["prompts"].values():
        assert "directly in `Implement`" in prompts["Review"]
        assert "directly in `Ready`" not in prompts["Review"]


def test_classic_workflow_is_an_inert_tracked_reference():
    repository_root = Path(__file__).resolve().parents[3]
    reference_path = repository_root / "backend/worktracker/docs/classic-workflow.json"
    classic = json.loads(reference_path.read_text(encoding="utf-8"))

    assert classic["referenceOnly"] is True
    assert [state["name"] for state in classic["states"]] == [
        "Idea",
        "Refinement",
        "Ready",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    ]
    assert "classic-workflow.json" not in (
        repository_root / "backend/worktracker/reviewed_defaults.py"
    ).read_text(encoding="utf-8")


def test_agents_guidance_matches_reviewed_artifact():
    repository_root = Path(__file__).resolve().parents[3]

    assert (
        repository_root.joinpath("AGENTS.md").read_text(encoding="utf-8").rstrip("\n")
        == REVIEWED_DEFAULTS["guidance"]
    )


@pytest.mark.django_db
def test_fresh_project_materializes_the_reviewed_artifact():
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="reviewed-defaults",
        name="Reviewed defaults",
    )
    created = create_project(
        name="Reviewed defaults",
        slug="RVD",
        workspace_slug=workspace.slug,
    )
    issue_types = list(
        IssueType.objects.filter(project=created, level="task").order_by("sort_order")
    )
    states = list(State.objects.filter(project=created).order_by("sort_order"))

    assert [issue_type.name for issue_type in issue_types] == REVIEWED_DEFAULTS[
        "issueTypes"
    ]
    assert [state.name for state in states] == [
        state["name"] for state in REVIEWED_DEFAULTS["states"]
    ]

    for issue_type in issue_types:
        workflow = REVIEWED_DEFAULTS["workflows"][issue_type.name]
        assert issue_type.start_state.name == workflow["start"]

        actual_edges = {
            (edge.from_state.name, edge.to_state.name, edge.agent_allowed)
            for edge in IssueTypeTransition.objects.filter(issue_type=issue_type)
        }
        expected_edges = {
            (
                edge[0],
                edge[1],
                edge[2].get("agentAllowed", True) if len(edge) == 3 else True,
            )
            for edge in workflow["transitions"]
        }
        assert actual_edges == expected_edges

        bindings = {
            binding.state.name: binding
            for binding in LaunchBinding.objects.filter(issue_type=issue_type)
        }
        assert {
            state_name: binding.prompt
            for state_name, binding in bindings.items()
        } == REVIEWED_DEFAULTS["prompts"][issue_type.name]
        assert {
            state_name: binding.required_skills
            for state_name, binding in bindings.items()
        } == REVIEWED_DEFAULTS["requiredSkills"]
        assert {
            state_name: binding.subtree_run_enabled
            for state_name, binding in bindings.items()
        } == {
            state["name"]: (
                issue_type.name == "Story" and state["name"] != "Ideas"
            )
            for state in REVIEWED_DEFAULTS["states"]
        }
        assert {
            state_name: binding.auto_start
            for state_name, binding in bindings.items()
        } == {
            state["name"]: state.get("autoStart", False)
            for state in REVIEWED_DEFAULTS["states"]
        }


@pytest.mark.django_db
def test_fresh_project_materializes_declared_non_default_policy_fixture(
    monkeypatch,
):
    monkeypatch.setitem(
        DEFAULT_WORKFLOW_TEMPLATES["Story"]["agent_allowed"],
        ("Grill", "Spec"),
        False,
    )
    monkeypatch.setitem(DEFAULT_AUTO_START_BY_STATE, "Grill", True)
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="declared-policy",
        name="Declared policy",
    )

    created = create_project(
        name="Declared policy",
        slug="DPL",
        workspace_slug=workspace.slug,
    )

    assert (
        IssueTypeTransition.objects.get(
            issue_type__project=created,
            issue_type__name="Story",
            from_state__name="Grill",
            to_state__name="Spec",
        ).agent_allowed
        is False
    )
    assert (
        LaunchBinding.objects.get(
            issue_type__project=created,
            issue_type__name="Story",
            state__name="Grill",
        ).auto_start
        is True
    )


@pytest.mark.django_db
def test_project_creation_only_adds_missing_seed_rows(monkeypatch):
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="additive-defaults",
        name="Additive defaults",
    )
    seeded = {}

    def insert_existing_rows(created, StateModel):
        canonical_state_order(created, StateModel)
        states = {
            state.name: state for state in StateModel.objects.filter(project=created)
        }
        story = IssueType.objects.create(
            id=uuid.uuid4(),
            project=created,
            name="Story",
            level="task",
            color="#123456",
            sort_order=17,
            start_state=states[REVIEWED_DEFAULTS["workflows"]["Story"]["start"]],
            workflow_revision=9,
        )
        source, target = REVIEWED_DEFAULTS["workflows"]["Story"]["transitions"][0][:2]
        transition = IssueTypeTransition.objects.create(
            issue_type=story,
            from_state=states[source],
            to_state=states[target],
            agent_allowed=False,
        )
        state_name = REVIEWED_DEFAULTS["states"][0]["name"]
        provider = Provider.objects.get(slug="claude")
        model = AgentModel.objects.create(
            provider=provider,
            name="project-owned-model",
        )
        reasoning = ReasoningLevel.objects.get(name="high")
        model.permitted_reasoning_levels.add(reasoning)
        binding = LaunchBinding.objects.create(
            issue_type=story,
            state=states[state_name],
            prompt="Project-owned prompt",
            required_skills=["project-owned-skill"],
            model=model,
            reasoning=reasoning,
            auto_start=True,
            subtree_run_enabled=False,
        )
        seeded.update(
            story=(story, model_snapshot(story)),
            transition=(transition, model_snapshot(transition)),
            binding=(binding, model_snapshot(binding)),
        )

    monkeypatch.setattr(
        "worktracker.services.projects.ensure_state_order",
        insert_existing_rows,
    )

    created = create_project(
        name="Additive defaults",
        slug="ADD",
        workspace_slug=workspace.slug,
    )

    for instance, before in seeded.values():
        instance.refresh_from_db()
        assert model_snapshot(instance) == before

    task_type_names = set(
        IssueType.objects.filter(project=created, level="task").values_list(
            "name", flat=True
        )
    )
    assert task_type_names == set(REVIEWED_DEFAULTS["issueTypes"])

    expected_edges = sum(
        len(REVIEWED_DEFAULTS["workflows"][issue_type]["transitions"])
        for issue_type in REVIEWED_DEFAULTS["issueTypes"]
    )
    assert (
        IssueTypeTransition.objects.filter(issue_type__project=created).count()
        == expected_edges
    )

    expected_bindings = len(REVIEWED_DEFAULTS["issueTypes"]) * len(
        REVIEWED_DEFAULTS["states"]
    )
    assert (
        LaunchBinding.objects.filter(issue_type__project=created).count()
        == expected_bindings
    )
