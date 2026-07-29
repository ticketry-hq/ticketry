"""Settle the lifecycle axis for runs that ended before it was authoritative.

``lifecycle_state`` used to be written only by an incoming hook event, so a run
whose agent had no session-end hook (Codex) or whose hooks never fired at all
(agy, gemini) kept whichever mid-turn state it last reported — forever. Those
rows still render a long-dead run as working or awaiting input every time the
status snapshot is read.

``TerminalSessionService.terminate``/``reconcile`` now stamp the terminal state
alongside ``ended_at``, but only for runs they end from here on; a run that
already ended is never revisited. This settles the existing rows once.

Deliberately narrow:

- Only rows with ``ended_at`` set are touched. A live run must keep reporting.
- Rows with no recorded state at all (empty/NULL) are left alone. "Unknown" is
  honest for a run that never reported; the misleading case this repairs is a
  finished run still claiming to be mid-turn.
"""

from django.db import migrations


# The states a finished run may legitimately rest in. Anything else on an ended
# run is a stale mid-turn report.
_TERMINAL_STATES = ("exited", "error")


def settle_ended_runs(apps, schema_editor):
    AgentRun = apps.get_model("runs", "AgentRun")

    stale = AgentRun.objects.filter(ended_at__isnull=False).exclude(
        lifecycle_state__in=(*_TERMINAL_STATES, "")
    ).exclude(lifecycle_state__isnull=True)

    # Pair the timestamp with the state so the row stays internally coherent,
    # matching what the exit paths now persist.
    for run in stale.only("id", "ended_at").iterator():
        AgentRun.objects.filter(pk=run.pk).update(
            lifecycle_state="exited",
            lifecycle_updated_at=run.ended_at,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0006_agentrun_scope"),
    ]

    operations = [
        # Irreversible in substance: the overwritten mid-turn states are not
        # recoverable, and restoring them would only reinstate the bug.
        migrations.RunPython(settle_ended_runs, migrations.RunPython.noop),
    ]
