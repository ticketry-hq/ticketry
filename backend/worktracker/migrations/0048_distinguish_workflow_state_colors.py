from django.db import migrations


DEFAULT_COLOR_CHANGES = {
    "Ideas": ("#D12771", "#60646C"),
    "Grill": ("#60646C", "#FA4D56"),
    "Review": ("#D6409F", "#08BDBA"),
}


def distinguish_workflow_state_colors(apps, schema_editor):
    State = apps.get_model("worktracker", "State")
    states = State.objects.using(schema_editor.connection.alias)

    for name, (previous_color, new_color) in DEFAULT_COLOR_CHANGES.items():
        states.filter(name=name, color__iexact=previous_color).update(color=new_color)


def restore_previous_workflow_state_colors(apps, schema_editor):
    State = apps.get_model("worktracker", "State")
    states = State.objects.using(schema_editor.connection.alias)

    for name, (previous_color, new_color) in DEFAULT_COLOR_CHANGES.items():
        states.filter(name=name, color__iexact=new_color).update(color=previous_color)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0047_launch_binding_entry_skill")]

    operations = [
        migrations.RunPython(
            distinguish_workflow_state_colors,
            restore_previous_workflow_state_colors,
        )
    ]
