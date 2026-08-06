import json

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


APP = "worktracker"
BEFORE = "0036_issue_module"
AFTER = "0037_provider_catalog"


@pytest.mark.django_db(transaction=True)
def test_migration_seeds_catalog_and_moves_activation_out_of_settings_json():
    executor = MigrationExecutor(connection)
    executor.migrate(
        [(APP, BEFORE), ("settings_store", "0002_migrate_profile_prompt_authority")]
    )
    executor.loader.build_graph()
    old = executor.loader.project_state(
        [(APP, BEFORE), ("settings_store", "0002_migrate_profile_prompt_authority")]
    ).apps
    AppSetting = old.get_model("settings_store", "AppSetting")
    AppSetting.objects.create(
        scope="host",
        key="provider_catalog",
        value=json.dumps(
            {
                "activated_providers": ["claude"],
                "global_default": {"provider": "claude", "model": "sonnet"},
            }
        ),
        updated_at="2026-08-05T00:00:00+00:00",
    )

    executor = MigrationExecutor(connection)
    executor.migrate([(APP, AFTER)])
    executor.loader.build_graph()
    new = executor.loader.project_state((APP, AFTER)).apps
    Provider = new.get_model(APP, "Provider")
    AgentModel = new.get_model(APP, "AgentModel")
    ReasoningLevel = new.get_model(APP, "ReasoningLevel")
    MigratedSetting = new.get_model("settings_store", "AppSetting")

    assert set(Provider.objects.values_list("slug", flat=True)) == {
        "claude",
        "agy",
        "codex",
        "gemini",
    }
    assert set(
        Provider.objects.filter(activated=True).values_list("slug", flat=True)
    ) == {"claude"}
    assert set(
        AgentModel.objects.filter(provider__slug="claude").values_list(
            "name", flat=True
        )
    ) == {"sonnet", "opus", "haiku", "fable"}
    assert {
        slug: set(
            AgentModel.objects.filter(provider__slug=slug).values_list(
                "name", flat=True
            )
        )
        for slug in ("agy", "codex", "gemini")
    } == {
        "agy": {"vendor/model"},
        "codex": {"gpt-5.4"},
        "gemini": {"gemini-3.1-pro-preview"},
    }
    assert set(ReasoningLevel.objects.values_list("name", flat=True)) == {
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    }
    assert json.loads(MigratedSetting.objects.get().value) == {
        "global_default": {"provider": "claude", "model": "sonnet"}
    }

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
