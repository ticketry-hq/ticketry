from django.db import migrations, models
import django.db.models.deletion


def materialize_per_type_transitions(apps, schema_editor):
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    State = apps.get_model("worktracker", "State")
    WorkflowConfiguration = apps.get_model("worktracker", "WorkflowConfiguration")
    alias = schema_editor.connection.alias

    state_ids = {
        str(value)
        for value in State.objects.using(alias).values_list("id", flat=True)
    }
    for issue_type in IssueType.objects.using(alias).all().order_by("id"):
        configuration = WorkflowConfiguration.objects.using(alias).filter(
            issue_type_id=issue_type.id
        ).first()
        if configuration is None:
            continue

        active = configuration.active or {}
        start_state_id = str(active.get("start_state_id") or "")
        if start_state_id in state_ids:
            issue_type.start_state_id = start_state_id
        issue_type.workflow_revision = configuration.revision
        issue_type.save(
            using=alias,
            update_fields=["start_state", "workflow_revision", "updated_at"]
        )

        transitions = []
        auto_start_state_ids = set()
        seen = set()
        for edge in active.get("edges") or []:
            from_state_id = str(edge.get("from") or "")
            to_state_id = str(edge.get("to") or "")
            key = (from_state_id, to_state_id)
            if (
                from_state_id not in state_ids
                or to_state_id not in state_ids
                or key in seen
            ):
                continue
            seen.add(key)
            transitions.append(
                IssueTypeTransition(
                    issue_type_id=issue_type.id,
                    from_state_id=from_state_id,
                    to_state_id=to_state_id,
                    agent_allowed=True,
                )
            )
            if edge.get("auto_launch") is True:
                auto_start_state_ids.add(to_state_id)
        IssueTypeTransition.objects.using(alias).bulk_create(transitions)
        LaunchBinding.objects.using(alias).filter(
            issue_type_id=issue_type.id,
            state_id__in=auto_start_state_ids,
        ).update(auto_start=True)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0024_migrate_shared_workflow_settings")]

    operations = [
        migrations.AddField(
            model_name="issuetype",
            name="start_state",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="starting_issue_types",
                to="worktracker.state",
            ),
        ),
        migrations.AddField(
            model_name="issuetype",
            name="workflow_revision",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="launchbinding",
            name="auto_start",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="IssueTypeTransition",
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
                ("agent_allowed", models.BooleanField(default=True)),
                (
                    "from_state",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="outgoing_type_transitions",
                        to="worktracker.state",
                    ),
                ),
                (
                    "issue_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="transitions",
                        to="worktracker.issuetype",
                    ),
                ),
                (
                    "to_state",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="incoming_type_transitions",
                        to="worktracker.state",
                    ),
                ),
            ],
            options={
                "ordering": (
                    "issue_type__sort_order",
                    "from_state__sort_order",
                    "to_state__sort_order",
                    "id",
                ),
                "constraints": [
                    models.UniqueConstraint(
                        fields=("issue_type", "from_state", "to_state"),
                        name="unique_issue_type_transition",
                    )
                ],
            },
        ),
        migrations.RunPython(
            materialize_per_type_transitions,
            migrations.RunPython.noop,
        ),
    ]
