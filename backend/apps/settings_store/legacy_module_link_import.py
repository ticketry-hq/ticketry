"""One-time import of Module links from retired local JSON configuration."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

from apps.settings_store.module_links import import_module_link

logger = logging.getLogger(__name__)

LEGACY_PROFILE_FILE = "profiles.json"
LEGACY_FEATURE_FILE = "features.json"


def _profile_links(
    profile: object, profile_index: int
) -> Iterator[tuple[object, object]]:
    if not isinstance(profile, dict):
        logger.warning(
            "legacy Module link import skipped profile %s: not an object", profile_index
        )
        return

    folders = profile.get("module_folders")
    if folders is not None:
        if isinstance(folders, dict):
            yield from folders.items()
        else:
            logger.warning(
                "legacy Module link import skipped profile %s module_folders: not an object",
                profile_index,
            )

    links = profile.get("module_links")
    if links is None:
        return
    if not isinstance(links, list):
        logger.warning(
            "legacy Module link import skipped profile %s module_links: not a list",
            profile_index,
        )
        return
    for link_index, link in enumerate(links):
        if not isinstance(link, dict):
            logger.warning(
                "legacy Module link import skipped profile %s link %s: not an object",
                profile_index,
                link_index,
            )
            continue
        yield link.get("module_id"), link.get("path")


def _links_from_file(profile_file: Path) -> Iterator[tuple[object, object]]:
    try:
        payload = json.loads(profile_file.read_text())
    except Exception as exc:
        logger.warning(
            "legacy Module link import could not read %s: %s", profile_file, exc
        )
        return
    if not isinstance(payload, dict) or not isinstance(payload.get("profiles"), list):
        logger.warning(
            "legacy Module link import skipped %s: profiles is not a list", profile_file
        )
        return
    for profile_index, profile in enumerate(payload["profiles"]):
        yield from _profile_links(profile, profile_index)


def import_legacy_module_links(data_dir: Path) -> int:
    """Import usable legacy links, then remove both retired files.

    File absence is the completion marker. Every entry is independent, so a
    damaged entry or database rejection cannot discard links imported before
    or after it. Duplicate module ids naturally use the last usable entry.
    """

    profile_file = data_dir / LEGACY_PROFILE_FILE
    feature_file = data_dir / LEGACY_FEATURE_FILE
    imported = 0
    try:
        if not profile_file.exists() and not feature_file.exists():
            return 0
        if profile_file.exists():
            for module_id, local_path in _links_from_file(profile_file):
                if not isinstance(module_id, str) or not module_id.strip():
                    logger.warning(
                        "legacy Module link import skipped entry: missing module id"
                    )
                    continue
                if not isinstance(local_path, str) or not local_path.strip():
                    logger.warning(
                        "legacy Module link import skipped module %s: invalid path",
                        module_id,
                    )
                    continue
                try:
                    import_module_link(module_id.strip(), local_path=local_path)
                except Exception as exc:
                    logger.warning(
                        "legacy Module link import skipped module %s: %s",
                        module_id,
                        exc,
                    )
                    continue
                imported += 1
    except Exception:
        logger.exception("legacy Module link import failed without blocking startup")
    finally:
        for retired_file in (profile_file, feature_file):
            try:
                retired_file.unlink(missing_ok=True)
            except Exception as exc:
                logger.warning(
                    "could not delete retired configuration file %s: %s",
                    retired_file,
                    exc,
                )
    return imported
