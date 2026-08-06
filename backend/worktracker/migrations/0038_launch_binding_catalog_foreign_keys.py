import json
import uuid

from django.db import migrations, models
import django.db.models.deletion


LEGACY_PROVIDER_SLUG = "legacy"


def _optional_text(value):
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _provider_for_model(Provider, AgentModel, *, agent, model_name, alias):
    if agent:
        provider, _ = Provider.objects.using(alias).get_or_create(
            slug=agent,
            defaults={"activated": False, "supports_unattended": False},
        )
        return provider

    candidates = list(
        AgentModel.objects.using(alias)
        .filter(name=model_name)
        .values_list("provider_id", flat=True)[:2]
    )
    if len(candidates) == 1:
        return Provider.objects.using(alias).get(pk=candidates[0])
    provider, _ = Provider.objects.using(alias).get_or_create(
        slug=LEGACY_PROVIDER_SLUG,
        defaults={"activated": False, "supports_unattended": False},
    )
    return provider


def _catalog_rows_for_triple(
    Provider,
    AgentModel,
    ReasoningLevel,
    AgentModelReasoningLevel,
    *,
    agent,
    model_name,
    reasoning_name,
    alias,
):
    model = None
    reasoning = None
    if model_name:
        provider = _provider_for_model(
            Provider,
            AgentModel,
            agent=agent,
            model_name=model_name,
            alias=alias,
        )
        model, _ = AgentModel.objects.using(alias).get_or_create(
            provider=provider,
            name=model_name,
            defaults={"id": uuid.uuid4()},
        )
    if reasoning_name:
        reasoning, _ = ReasoningLevel.objects.using(alias).get_or_create(
            name=reasoning_name,
            defaults={"id": uuid.uuid4()},
        )
        if model is not None:
            AgentModelReasoningLevel.objects.using(alias).get_or_create(
                agent_model=model,
                reasoning_level=reasoning,
            )
    return model, reasoning


def map_launch_bindings_to_catalog(apps, schema_editor):
    Provider = apps.get_model("worktracker", "Provider")
    AgentModel = apps.get_model("worktracker", "AgentModel")
    ReasoningLevel = apps.get_model("worktracker", "ReasoningLevel")
    AgentModelReasoningLevel = apps.get_model("worktracker", "AgentModelReasoningLevel")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    AppSetting = apps.get_model("settings_store", "AppSetting")
    alias = schema_editor.connection.alias

    for binding in LaunchBinding.objects.using(alias).all().iterator():
        model, reasoning = _catalog_rows_for_triple(
            Provider,
            AgentModel,
            ReasoningLevel,
            AgentModelReasoningLevel,
            agent=_optional_text(binding.agent),
            model_name=_optional_text(binding.model),
            reasoning_name=_optional_text(binding.reasoning),
            alias=alias,
        )
        binding.catalog_model_id = model.pk if model else None
        binding.catalog_reasoning_id = reasoning.pk if reasoning else None
        binding.save(
            update_fields=("catalog_model", "catalog_reasoning"),
            using=alias,
        )

    setting = (
        AppSetting.objects.using(alias)
        .filter(scope="host", key="provider_catalog")
        .first()
    )
    if setting is None:
        return
    try:
        document = json.loads(setting.value)
    except (TypeError, ValueError):
        return
    default = document.get("global_default") if isinstance(document, dict) else None
    if not isinstance(default, dict):
        return
    _catalog_rows_for_triple(
        Provider,
        AgentModel,
        ReasoningLevel,
        AgentModelReasoningLevel,
        agent=_optional_text(default.get("provider")),
        model_name=_optional_text(default.get("model")),
        reasoning_name=_optional_text(default.get("reasoning")),
        alias=alias,
    )


def flush_deferred_foreign_key_checks(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor == "postgresql":
        connection.check_constraints()


class Migration(migrations.Migration):
    dependencies = [
        ("settings_store", "0002_migrate_profile_prompt_authority"),
        ("worktracker", "0037_provider_catalog"),
    ]

    operations = [
        migrations.AddField(
            model_name="launchbinding",
            name="catalog_model",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="launch_bindings",
                to="worktracker.agentmodel",
            ),
        ),
        migrations.AddField(
            model_name="launchbinding",
            name="catalog_reasoning",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="launch_bindings",
                to="worktracker.reasoninglevel",
            ),
        ),
        migrations.RunPython(map_launch_bindings_to_catalog, migrations.RunPython.noop),
        migrations.RunPython(
            flush_deferred_foreign_key_checks,
            migrations.RunPython.noop,
        ),
        migrations.RemoveField(model_name="launchbinding", name="agent"),
        migrations.RemoveField(model_name="launchbinding", name="model"),
        migrations.RemoveField(model_name="launchbinding", name="reasoning"),
        migrations.RenameField(
            model_name="launchbinding", old_name="catalog_model", new_name="model"
        ),
        migrations.RenameField(
            model_name="launchbinding",
            old_name="catalog_reasoning",
            new_name="reasoning",
        ),
    ]
