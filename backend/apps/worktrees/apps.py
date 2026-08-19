from django.apps import AppConfig


class WorktreesConfig(AppConfig):
    name = "apps.worktrees"

    # No signal receivers. The auto-integrate-on-Done close hook was retired at
    # the Slice 4 handoff: Rust owns worktree integration, and it is driven by
    # committed transition occurrences rather than a Django ``post_save`` that
    # ran a git merge on a daemon thread with no durable recovery record.
