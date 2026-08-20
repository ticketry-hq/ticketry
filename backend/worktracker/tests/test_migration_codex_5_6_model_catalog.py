import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0043_story_run_now_workflow"
AFTER = "0044_codex_5_6_model_catalog"
EXPECTED = {
    "gpt-5.6-sol": {"low", "medium", "high", "xhigh", "max", "ultra"},
    "gpt-5.6-terra": {"low", "medium", "high", "xhigh", "max", "ultra"},
    "gpt-5.6-luna": {"low", "medium", "high", "xhigh", "max"},
}


def _migrate_to_before():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    apps = executor.loader.project_state((APP, BEFORE)).apps
    Provider = apps.get_model(APP, "Provider")
    AgentModel = apps.get_model(APP, "AgentModel")
    ReasoningLevel = apps.get_model(APP, "ReasoningLevel")
    codex, _ = Provider.objects.get_or_create(
        slug="codex",
        defaults={"id": uuid.uuid4(), "activated": True, "supports_unattended": True},
    )
    Provider.objects.get_or_create(
        slug="claude",
        defaults={"id": uuid.uuid4(), "activated": True, "supports_unattended": True},
    )
    legacy, _ = AgentModel.objects.get_or_create(
        provider=codex,
        name="gpt-5.4",
        defaults={"id": uuid.uuid4()},
    )
    for name in ("minimal", "low", "medium", "high", "xhigh", "max"):
        level, _ = ReasoningLevel.objects.get_or_create(
            name=name, defaults={"id": uuid.uuid4()}
        )
        if name != "max":
            legacy.permitted_reasoning_levels.add(level)
    return apps


def _migrate_to_after():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    return executor, executor.loader.project_state((APP, AFTER)).apps


def _codex_matrix(apps):
    AgentModel = apps.get_model(APP, "AgentModel")
    return {
        model.name: set(model.permitted_reasoning_levels.values_list("name", flat=True))
        for model in AgentModel.objects.filter(
            provider__slug="codex", name__in=EXPECTED
        )
    }


@pytest.mark.django_db(transaction=True)
def test_migration_publishes_the_exact_codex_5_6_catalog_on_fresh_installations():
    old = _migrate_to_before()
    AgentModel = old.get_model(APP, "AgentModel")
    AgentModel.objects.filter(provider__slug="codex", name__in=EXPECTED).delete()
    assert not AgentModel.objects.filter(
        provider__slug="codex", name__in=EXPECTED
    ).exists()

    executor, new = _migrate_to_after()
    MigratedAgentModel = new.get_model(APP, "AgentModel")

    assert _codex_matrix(new) == EXPECTED
    assert {
        name: MigratedAgentModel.objects.filter(
            provider__slug="codex", name=name
        ).count()
        for name in EXPECTED
    } == {name: 1 for name in EXPECTED}

    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_migration_reconciles_partial_rows_and_preserves_unrelated_catalog_data():
    old = _migrate_to_before()
    Provider = old.get_model(APP, "Provider")
    AgentModel = old.get_model(APP, "AgentModel")
    ReasoningLevel = old.get_model(APP, "ReasoningLevel")
    AgentModelReasoningLevel = old.get_model(APP, "AgentModelReasoningLevel")

    codex = Provider.objects.get(slug="codex")
    claude = Provider.objects.get(slug="claude")
    ultra = ReasoningLevel.objects.create(id=uuid.uuid4(), name="ultra")
    custom = ReasoningLevel.objects.create(id=uuid.uuid4(), name="custom-effort")
    luna = AgentModel.objects.create(
        id=uuid.uuid4(), provider=codex, name="gpt-5.6-luna"
    )
    user_model = AgentModel.objects.create(
        id=uuid.uuid4(), provider=codex, name="my-codex-model"
    )
    other_provider_model = AgentModel.objects.create(
        id=uuid.uuid4(), provider=claude, name="my-claude-model"
    )
    for model, level in (
        (luna, ultra),
        (luna, ReasoningLevel.objects.get(name="low")),
        (user_model, custom),
        (other_provider_model, ultra),
    ):
        AgentModelReasoningLevel.objects.create(
            agent_model=model, reasoning_level=level
        )

    executor, new = _migrate_to_after()
    MigratedAgentModel = new.get_model(APP, "AgentModel")
    MigratedReasoningLevel = new.get_model(APP, "ReasoningLevel")

    assert _codex_matrix(new) == EXPECTED
    assert all(
        MigratedAgentModel.objects.filter(provider__slug="codex", name=name).count()
        == 1
        for name in EXPECTED
    )
    assert set(
        MigratedAgentModel.objects.get(
            provider__slug="codex", name="gpt-5.4"
        ).permitted_reasoning_levels.values_list("name", flat=True)
    ) == {"minimal", "low", "medium", "high", "xhigh"}
    assert set(
        MigratedAgentModel.objects.get(
            provider__slug="codex", name="my-codex-model"
        ).permitted_reasoning_levels.values_list("name", flat=True)
    ) == {"custom-effort"}
    assert set(
        MigratedAgentModel.objects.get(
            provider__slug="claude", name="my-claude-model"
        ).permitted_reasoning_levels.values_list("name", flat=True)
    ) == {"ultra"}
    assert MigratedReasoningLevel.objects.filter(name="custom-effort").exists()

    executor.migrate(executor.loader.graph.leaf_nodes())
