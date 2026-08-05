"""Local profile selection and persistence owned by settings-store."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional, TypedDict

from studio_server.atomic_files import atomic_write_json

# The packaged sidecar supplies this before Django imports settings.  Keeping
# the default preserves the browser/development runtime's established state
# location while allowing the desktop supervisor to own its data directory.
# ``studio_server.settings`` derives the database, token, and media paths from
# it, so this definition must exist by import time.
CONFIG_DIR = Path(
    os.environ.get("MUXED_DATA_DIR", Path.home() / ".config" / "worktracker-studio")
).expanduser()

CONFIG_FILE = CONFIG_DIR / "profiles.json"
FEATURES_FILE = CONFIG_DIR / "features.json"
DEFAULT_FEATURES = {"sidebar": False, "projects": False}
PROFILE_FIELDS = {
    "name",
    "workspace_slug",
    "agent_prompt",
    "agent_prompts",
    "module_links",
    "recent_project_id",
    "recent_module_ids",
}


class ModuleLink(TypedDict):
    """A profile-scoped association between a module and its local path."""

    module_id: str
    path: str


def load_features() -> dict[str, bool]:
    """Read installation feature flags, falling back safely for every error."""

    try:
        data = json.loads(FEATURES_FILE.read_text())
    except Exception:
        return DEFAULT_FEATURES.copy()
    if not isinstance(data, dict):
        return DEFAULT_FEATURES.copy()
    resolved = {
        "sidebar": (
            data["sidebar"]
            if isinstance(data.get("sidebar"), bool)
            else DEFAULT_FEATURES["sidebar"]
        ),
        "projects": (
            data["projects"]
            if isinstance(data.get("projects"), bool)
            else DEFAULT_FEATURES["projects"]
        ),
    }
    if not resolved["sidebar"]:
        resolved["projects"] = False
    return resolved


class NoConfigurationSelected(Exception):
    """No stored local configuration can satisfy a launch request."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class Profile:
    def __init__(
        self,
        name: str,
        workspace_slug: str,
        agent_prompt: Optional[str] = None,
        agent_prompts: Optional[dict] = None,
        module_links: Optional[list[ModuleLink]] = None,
        recent_project_id: Optional[str] = None,
        recent_module_ids: Optional[dict] = None,
    ):
        self.name = name
        self.workspace_slug = workspace_slug
        self.agent_prompt = agent_prompt
        self.agent_prompts = agent_prompts or {}
        self.module_links: list[ModuleLink] = [
            dict(link) for link in (module_links or [])
        ]
        self.recent_project_id = recent_project_id
        self.recent_module_ids = recent_module_ids or {}


def module_link_path(
    profile: Optional[Profile], module_id: Optional[str]
) -> Optional[str]:
    """Return a module's path from links scoped to ``profile``.

    Duplicate module IDs use the last link. Missing module IDs and empty paths
    are both represented as ``None`` so each public consumer can preserve its
    own explicit fallback.
    """

    if profile is None or not module_id:
        return None
    for link in reversed(profile.module_links):
        if link["module_id"] == module_id:
            return link["path"] or None
    return None


class Config:
    def __init__(self):
        self.profiles: list[Profile] = []
        self.current_profile_index = 0
        self.recent_profile_index: Optional[int] = None
        self.load_profiles()

    def load_profiles(self) -> None:
        if not CONFIG_FILE.exists():
            return
        try:
            data = json.loads(CONFIG_FILE.read_text())
            self.profiles = [
                Profile(**profile_from_storage_dict(profile))
                for profile in data.get("profiles", [])
            ]
            self.recent_profile_index = data.get("recent_profile_index")
        except Exception:
            self.profiles = []

    def save_profiles(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            "recent_profile_index": self.recent_profile_index,
            "profiles": [profile_to_storage_dict(profile) for profile in self.profiles],
        }
        atomic_write_json(CONFIG_FILE, data, indent=4)

    @property
    def current_profile(self) -> Optional[Profile]:
        if not self.profiles:
            return None
        return self.profiles[self.current_profile_index]


def profile_from_storage_dict(profile: dict) -> dict:
    """Translate a stored profile into the canonical runtime contract."""

    current = {key: value for key, value in profile.items() if key in PROFILE_FIELDS}
    if "module_links" not in current:
        legacy_folders = profile.get("module_folders")
        if isinstance(legacy_folders, dict):
            current["module_links"] = [
                {"module_id": module_id, "path": path}
                for module_id, path in legacy_folders.items()
            ]
    return current


def profile_to_dict(profile: Profile) -> dict:
    """Return the canonical configuration API representation for a profile."""

    return {
        "name": profile.name,
        "workspace_slug": profile.workspace_slug,
        "agent_prompt": profile.agent_prompt,
        "agent_prompts": profile.agent_prompts,
        "module_links": profile.module_links,
        "recent_project_id": profile.recent_project_id,
        "recent_module_ids": profile.recent_module_ids,
    }


def profile_to_storage_dict(profile: Profile) -> dict:
    """Return the canonical local-settings representation for a profile."""

    return {
        "name": profile.name,
        "workspace_slug": profile.workspace_slug,
        "agent_prompt": profile.agent_prompt,
        "agent_prompts": profile.agent_prompts,
        "module_links": profile.module_links,
        "recent_project_id": profile.recent_project_id,
        "recent_module_ids": profile.recent_module_ids,
    }


def load_config() -> Config:
    return Config()


def resolve_profile_index(config: Config, requested: Optional[int]) -> int:
    if not config.profiles:
        raise NoConfigurationSelected("No profiles configured.")
    index = (
        requested
        if requested is not None
        else config.recent_profile_index
        if config.recent_profile_index is not None
        else 0
    )
    if index < 0 or index >= len(config.profiles):
        raise NoConfigurationSelected("Profile index out of range.")
    return index


def resolve_profile(requested: Optional[int]) -> Profile:
    config = load_config()
    return config.profiles[resolve_profile_index(config, requested)]


features = load_features()
config = Config()
