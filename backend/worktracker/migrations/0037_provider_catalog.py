import json
import uuid

from django.db import migrations, models
import django.db.models.deletion


PROVIDERS = (
    ("claude", True),
    ("agy", True),
    ("codex", True),
    ("gemini", True),
)
DEFAULT_ACTIVATED = frozenset({"claude", "codex", "gemini"})
MODEL_ALIASES = {
    "claude": ("sonnet", "opus", "haiku", "fable"),
    "agy": ("vendor/model",),
    "codex": ("gpt-5.4",),
    "gemini": ("gemini-3.1-pro-preview",),
}
REASONING_LEVELS = {
    "claude": ("low", "medium", "high", "xhigh", "max"),
    "codex": ("minimal", "low", "medium", "high", "xhigh"),
}


def _move_activation_from_settings(apps, alias):
    AppSetting = apps.get_model("settings_store", "AppSetting")
    setting = (
        AppSetting.objects.using(alias)
        .filter(scope="host", key="provider_catalog")
        .first()
    )
    if setting is None:
        return DEFAULT_ACTIVATED

    try:
        document = json.loads(setting.value)
    except (TypeError, ValueError):
        document = {}
    if not isinstance(document, dict):
        document = {}

    stored = document.pop("activated_providers", None)
    activated = (
        frozenset(value for value in stored if isinstance(value, str))
        if isinstance(stored, list)
        else DEFAULT_ACTIVATED
    )
    document.setdefault("global_default", None)
    setting.value = json.dumps(document, separators=(",", ":"))
    setting.save(update_fields=["value"], using=alias)
    return activated


def seed_provider_catalog(apps, schema_editor):
    Provider = apps.get_model("worktracker", "Provider")
    AgentModel = apps.get_model("worktracker", "AgentModel")
    ReasoningLevel = apps.get_model("worktracker", "ReasoningLevel")
    AgentModelReasoningLevel = apps.get_model("worktracker", "AgentModelReasoningLevel")
    alias = schema_editor.connection.alias
    activated = _move_activation_from_settings(apps, alias)

    providers = {}
    for slug, supports_unattended in PROVIDERS:
        providers[slug] = Provider.objects.using(alias).create(
            id=uuid.uuid4(),
            slug=slug,
            activated=slug in activated,
            supports_unattended=supports_unattended,
        )

    levels = {}
    for name in sorted(
        {name for values in REASONING_LEVELS.values() for name in values}
    ):
        levels[name] = ReasoningLevel.objects.using(alias).create(
            id=uuid.uuid4(), name=name
        )

    for provider_slug, names in MODEL_ALIASES.items():
        for name in names:
            agent_model = AgentModel.objects.using(alias).create(
                id=uuid.uuid4(), provider=providers[provider_slug], name=name
            )
            AgentModelReasoningLevel.objects.using(alias).bulk_create(
                [
                    AgentModelReasoningLevel(
                        agent_model=agent_model,
                        reasoning_level=levels[level],
                    )
                    for level in REASONING_LEVELS.get(provider_slug, ())
                ]
            )


class Migration(migrations.Migration):
    dependencies = [
        ("settings_store", "0002_migrate_profile_prompt_authority"),
        ("worktracker", "0036_issue_module"),
    ]

    operations = [
        migrations.CreateModel(
            name="Provider",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("slug", models.CharField(max_length=64, unique=True)),
                ("activated", models.BooleanField(default=False)),
                ("supports_unattended", models.BooleanField(default=False)),
            ],
            options={"ordering": ("slug",)},
        ),
        migrations.CreateModel(
            name="ReasoningLevel",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=32, unique=True)),
            ],
            options={"ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="AgentModel",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=255)),
                (
                    "provider",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="models",
                        to="worktracker.provider",
                    ),
                ),
            ],
            options={"ordering": ("provider__slug", "name")},
        ),
        migrations.CreateModel(
            name="AgentModelReasoningLevel",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "agent_model",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="worktracker.agentmodel",
                    ),
                ),
                (
                    "reasoning_level",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="worktracker.reasoninglevel",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="agentmodel",
            name="permitted_reasoning_levels",
            field=models.ManyToManyField(
                blank=True,
                related_name="agent_models",
                through="worktracker.AgentModelReasoningLevel",
                to="worktracker.reasoninglevel",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentmodel",
            constraint=models.UniqueConstraint(
                fields=("provider", "name"),
                name="unique_agent_model_provider_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentmodelreasoninglevel",
            constraint=models.UniqueConstraint(
                fields=("agent_model", "reasoning_level"),
                name="unique_agent_model_reasoning_level",
            ),
        ),
        migrations.RunPython(seed_provider_catalog, migrations.RunPython.noop),
    ]
