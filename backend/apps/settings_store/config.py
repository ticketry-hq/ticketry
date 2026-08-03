"""Local profile selection and persistence owned by settings-store."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Optional

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
    "module_folders",
    "recent_project_id",
    "recent_module_ids",
}


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
        )
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
        module_folders: Optional[dict] = None,
        recent_project_id: Optional[str] = None,
        recent_module_ids: Optional[dict] = None,
    ):
        self.name = name
        self.workspace_slug = workspace_slug
        self.agent_prompt = agent_prompt
        self.agent_prompts = agent_prompts or {}
        self.module_folders = module_folders or {}
        self.recent_project_id = recent_project_id
        self.recent_module_ids = recent_module_ids or {}


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
                Profile(
                    **{
                        key: value
                        for key, value in profile.items()
                        if key in PROFILE_FIELDS
                    }
                )
                for profile in data.get("profiles", [])
            ]
            self.recent_profile_index = data.get("recent_profile_index")
        except Exception:
            self.profiles = []

    def save_profiles(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            "recent_profile_index": self.recent_profile_index,
            "profiles": [profile_to_dict(profile) for profile in self.profiles],
        }
        payload = json.dumps(data, indent=4)
        fd, tmp_path = tempfile.mkstemp(
            prefix=CONFIG_FILE.name + ".", suffix=".tmp", dir=str(CONFIG_DIR)
        )
        tmp = Path(tmp_path)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(payload)
            os.replace(tmp, CONFIG_FILE)
        except Exception:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            raise

    @property
    def current_profile(self) -> Optional[Profile]:
        if not self.profiles:
            return None
        return self.profiles[self.current_profile_index]


def profile_to_dict(profile: Profile) -> dict:
    return {
        "name": profile.name,
        "workspace_slug": profile.workspace_slug,
        "agent_prompt": profile.agent_prompt,
        "agent_prompts": profile.agent_prompts,
        "module_folders": profile.module_folders,
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
