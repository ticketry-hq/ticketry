"""Migrate every project to the canonical seven-state SDLC taxonomy (CODIN-859).

Slice 1 of the workflow-states revamp: vocabulary, groups, ordering, colors,
protection, and type defaults only — no transition rules or gates. Per project,
this migration renames-in-place where a source row maps 1:1, folds every
non-canonical state into Refinement (reassigning its issues first, then deleting
the row), extends with Ready/Review if absent, and repoints old ``Task`` issue
types to ``Story``. Issue ``state_id`` references survive wherever possible; no
issue is ever left pointing at a deleted state.

Idempotent: a second run finds only canonical rows, so no rename, fold, or
duplicate creation happens, and colors/protection/sort_order are already stable.
The migration carries a frozen copy of the vocabulary so later seed changes
cannot alter fresh-install history.
"""

import uuid

from django.db import migrations

# Old → new for the three states that map 1:1 (renamed in place, preserving the
# row and every ``Issue.state_id`` pointing at it).
RENAMES = {
    "Backlog": ("Idea", "backlog"),
    "Todo": ("Refinement", "unstarted"),
    "In Progress": ("Implement", "started"),
}

# The final canonical state set: name → group.
CANONICAL = {
    "Idea": "backlog",
    "Refinement": "unstarted",
    "Ready": "unstarted",
    "Implement": "started",
    "Review": "started",
    "Done": "completed",
    "Cancelled": "cancelled",
}

COLORS = {
    "Idea": "#60646C",
    "Refinement": "#8E4EC6",
    "Ready": "#0091FF",
    "Implement": "#F59E0B",
    "Review": "#D6409F",
    "Done": "#46A758",
    "Cancelled": "#9AA4BC",
}


def ensure_historical_issue_types(project, IssueType, alias):
    """Keep the 0010 data shape stable as later seeds evolve."""
    defaults = {}
    for order, (name, level, is_default) in enumerate([
        ("Epic", "module", True),
        ("Story", "task", True),
        ("PathFind", "task", False),
        ("Implementation", "task", False),
    ]):
        issue_type, _ = IssueType.objects.using(alias).get_or_create(
            project=project,
            name=name,
            defaults={
                "id": uuid.uuid4(), "level": level, "sort_order": order,
                "is_default": is_default,
            },
        )
        if is_default:
            defaults[level] = issue_type
    for level, default_type in defaults.items():
        IssueType.objects.using(alias).filter(project=project, level=level).exclude(
            id=default_type.id
        ).update(is_default=False)
        if not default_type.is_default:
            default_type.is_default = True
            default_type.save(using=alias, update_fields=["is_default"])
    return defaults


def migrate(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    Issue = apps.get_model("worktracker", "Issue")
    IssueType = apps.get_model("worktracker", "IssueType")
    State = apps.get_model("worktracker", "State")

    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    for project in Project.objects.using(alias).all():
        _migrate_states(project, State, Issue, alias)
        _migrate_types(project, IssueType, Issue, alias)


def _migrate_states(project, State, Issue, alias):
    states = State.objects.using(alias)
    issues = Issue.objects.using(alias)
    by_name = {s.name: s for s in states.filter(project=project)}

    # 1. Rename the three 1:1 states in place — only when the target name is
    #    free, so a re-run (or a project that already has the target) folds
    #    instead of colliding on the unique row.
    for old, (new, group) in RENAMES.items():
        src = by_name.get(old)
        if src is not None and new not in by_name:
            src.name = new
            src.group = group
            src.save(using=alias, update_fields=["name", "group"])
            by_name.pop(old)
            by_name[new] = src

    # 2. Ensure every canonical row exists (Ready/Review are the new ones; the
    #    rest are covered by renames above or already present). Normalize the
    #    group of any pre-existing canonical row to its canonical group.
    for name, group in CANONICAL.items():
        state = by_name.get(name)
        if state is None:
            state = states.create(
                id=uuid.uuid4(), project=project, name=name, group=group
            )
            by_name[name] = state
        elif state.group != group:
            state.group = group
            state.save(using=alias, update_fields=["group"])

    refinement = by_name["Refinement"]

    # 3. Fold every non-canonical state (Blocked, LLD, HLD, any ad-hoc row) into
    #    Refinement: reassign its issues first, then delete the row. No issue is
    #    left pointing at a deleted state.
    for name, state in list(by_name.items()):
        if name in CANONICAL:
            continue
        issues.filter(project=project, state=state).update(state=refinement)
        state.delete(using=alias)
        del by_name[name]

    # 4. Colors, protection, and canonical sort_order.
    ordered = sorted(
        states.filter(project=project),
        key=lambda state: list(CANONICAL).index(state.name),
    )
    for index, state in enumerate(ordered):
        changed = []
        if state.color != COLORS[state.name]:
            state.color = COLORS[state.name]
            changed.append("color")
        if not state.is_protected:
            state.is_protected = True
            changed.append("is_protected")
        if state.sort_order != index:
            state.sort_order = index
            changed.append("sort_order")
        if changed:
            state.save(using=alias, update_fields=changed)


def _migrate_types(project, IssueType, Issue, alias):
    types = IssueType.objects.using(alias)
    issues = Issue.objects.using(alias)
    # Seed the four types canonical when this migration was authored. This is
    # deliberately frozen: newer migrations own later vocabulary changes.
    ensure_historical_issue_types(project, IssueType, alias)

    story = types.filter(project=project, name="Story", level="task").first()
    if story is None:  # defensive; ensure_issue_types always creates it.
        return

    # Repoint the old seeded "Task" type's issues to Story, then retire it.
    task_type = types.filter(
        project=project, name="Task", level="task"
    ).first()
    if task_type is not None:
        issues.filter(project=project, issue_type=task_type).update(
            issue_type=story
        )
        task_type.delete(using=alias)

    # Any task-level issue still missing a type lands on the task default (Story);
    # module-level issues without one land on Epic.
    epic = types.filter(
        project=project, name="Epic", level="module"
    ).first()
    issues.filter(
        project=project, type="task", issue_type__isnull=True
    ).update(issue_type=story)
    if epic is not None:
        issues.filter(
            project=project, type="module", issue_type__isnull=True
        ).update(issue_type=epic)


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0009_issue_lifecycle_state"),
    ]

    operations = [
        # Pure data reshape; irreversible (the folded rows and old names are not
        # reconstructable), so reverse is a no-op.
        migrations.RunPython(migrate, migrations.RunPython.noop),
    ]
