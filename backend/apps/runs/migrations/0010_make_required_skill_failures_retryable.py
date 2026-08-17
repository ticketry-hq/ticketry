from django.db import migrations


def make_required_skill_failures_retryable(apps, schema_editor):
    AutomationAttempt = apps.get_model("runs", "AutomationAttempt")
    alias = schema_editor.connection.alias
    unresolved = AutomationAttempt.objects.using(alias).filter(
        status="failed",
        retryable=False,
    ).only("id", "error", "error_details")
    retryable_ids = []
    for attempt in unresolved.iterator():
        details = attempt.error_details
        structured = (
            isinstance(details, dict)
            and details.get("code") == "required_skill_unavailable"
        )
        legacy = (attempt.error or "").startswith("required_skill_unavailable:")
        if structured or legacy:
            retryable_ids.append(attempt.id)
    if retryable_ids:
        AutomationAttempt.objects.using(alias).filter(id__in=retryable_ids).update(
            retryable=True
        )


class Migration(migrations.Migration):
    dependencies = [("runs", "0009_automationattempt_launch_rejection")]

    operations = [
        migrations.RunPython(
            make_required_skill_failures_retryable,
            migrations.RunPython.noop,
        )
    ]
