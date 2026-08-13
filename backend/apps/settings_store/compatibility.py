"""Read-only access to Rust-owned local profile files for Django effects.

Documents, worktrees, and terminals still run in the supervised Python
sidecar. Until those effects move, they resolve profiles from a fresh Config
on every operation and never persist or cache the Rust-owned JSON files.
"""

from __future__ import annotations

from typing import Optional

from apps.settings_store.config import Config, Profile, resolve_profile_index


def read_config() -> Config:
    """Load the authoritative profile file without retaining server state."""

    return Config()


def read_profile(requested: Optional[int] = None) -> Profile:
    """Resolve one profile from a fresh, read-only configuration snapshot."""

    config = read_config()
    return config.profiles[resolve_profile_index(config, requested)]
