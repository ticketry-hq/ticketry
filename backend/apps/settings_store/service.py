"""Profile/config domain logic for the settings endpoints.

Owns reads and mutations of the local :class:`~apps.settings_store.config.Config`
profile list — add, replace, delete (with recent-index reconciliation), and
selecting the recent profile — plus the payload shaping the API returns.
:mod:`apps.settings_store.api` is the thin HTTP translator over these
functions and maps :class:`IndexOutOfRange` to a 400.
"""

from __future__ import annotations

from apps.settings_store.config import (
    Config,
    Profile,
    config as shared_config,
    load_config,
    profile_to_dict,
)


class IndexOutOfRange(Exception):
    """Raised when a profile index does not address an existing profile."""


def _config_payload(config: Config) -> dict:
    return {
        "recent_profile_index": config.recent_profile_index,
        "profiles": [profile_to_dict(profile) for profile in config.profiles],
    }


def _require_index(config: Config, index: int) -> None:
    if index < 0 or index >= len(config.profiles):
        raise IndexOutOfRange(index)


def list_config() -> dict:
    """Return the current connection config as a payload dict."""

    return _config_payload(load_config())


def ensure_local_profile(*, name: str, workspace_slug: str) -> dict:
    """Create the implicit owned profile once and refresh in-process readers."""

    config = load_config()
    if not config.profiles:
        config.profiles.append(Profile(name=name, workspace_slug=workspace_slug))
        config.recent_profile_index = 0
        config.save_profiles()
    shared_config.profiles = config.profiles
    shared_config.recent_profile_index = config.recent_profile_index
    return _config_payload(config)


def add_profile(data: dict) -> dict:
    """Append a profile built from ``data`` and persist."""

    config = load_config()
    config.profiles.append(Profile(**data))
    config.save_profiles()
    return _config_payload(config)


def replace_profile(index: int, data: dict) -> dict:
    """Replace the profile at ``index`` and persist.

    :raises IndexOutOfRange: if ``index`` addresses no existing profile.
    """

    config = load_config()
    _require_index(config, index)
    config.profiles[index] = Profile(**data)
    config.save_profiles()
    return _config_payload(config)


def delete_profile(index: int) -> dict:
    """Delete the profile at ``index``, reconciling the recent index, and persist.

    :raises IndexOutOfRange: if ``index`` addresses no existing profile.
    """

    config = load_config()
    _require_index(config, index)
    del config.profiles[index]
    if config.recent_profile_index is not None and config.recent_profile_index == index:
        config.recent_profile_index = 0 if config.profiles else None
    elif config.recent_profile_index is not None and config.recent_profile_index > index:
        config.recent_profile_index -= 1
    config.save_profiles()
    return _config_payload(config)


def set_recent_index(index: int) -> dict:
    """Select the recent profile by ``index`` and persist.

    :raises IndexOutOfRange: if ``index`` addresses no existing profile.
    """

    config = load_config()
    _require_index(config, index)
    config.recent_profile_index = index
    config.save_profiles()
    return _config_payload(config)
