import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
CATALOG_BEFORE = "0043_story_run_now_workflow"
BEFORE = "0050_module_presentation"
AFTER = "0051_codex_5_3_model_catalog"
MODEL_NAME = "gpt-5.3-codex-spark"


def _migrate_to_before():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, CATALOG_BEFORE)])
    executor.loader.build_graph()
    apps = executor.loader.project_state((APP, CATALOG_BEFORE)).apps
    Provider = apps.get_model(APP, "Provider")
    Provider.objects.get_or_create(
        slug="codex",
        defaults={"id": uuid.uuid4(), "activated": True, "supports_unattended": True},
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, BEFORE)])
    executor.loader.build_graph()
    apps = executor.loader.project_state((APP, BEFORE)).apps
    AgentModel = apps.get_model(APP, "AgentModel")
    codex = apps.get_model(APP, "Provider").objects.get(slug="codex")
    AgentModel.objects.filter(provider=codex, name=MODEL_NAME).delete()
    assert not AgentModel.objects.filter(
        provider=codex, name=MODEL_NAME
    ).exists()
    return executor


def _migrate_to_after():
    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    return executor, executor.loader.project_state((APP, AFTER)).apps


@pytest.mark.django_db(transaction=True)
def test_migration_adds_gpt_5_3_codex_spark_to_the_catalog():
    _migrate_to_before()

    executor, new = _migrate_to_after()
    AgentModel = new.get_model(APP, "AgentModel")

    codex_model = AgentModel.objects.get(
        provider__slug="codex",
        name=MODEL_NAME,
    )
    assert codex_model.permitted_reasoning_levels.count() == 0

    assert {
        row.name
        for row in AgentModel.objects.filter(provider__slug="codex")
    }.issuperset({"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", MODEL_NAME})

    executor.migrate(executor.loader.graph.leaf_nodes())
