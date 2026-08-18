"""Validate local module working directories before they are persisted."""

from __future__ import annotations

import os
from typing import Literal, TypedDict


ModuleFolderRefusal = Literal[
    "module_folder_not_absolute",
    "module_folder_missing",
    "module_folder_not_a_directory",
]


class ModuleFolderValidation(TypedDict):
    valid: bool
    reason: ModuleFolderRefusal | None


def validate_module_folder(path: str) -> ModuleFolderValidation:
    """Return whether ``path`` is an existing directory on this host."""

    candidate = path.strip()
    if not os.path.isabs(candidate):
        return {"valid": False, "reason": "module_folder_not_absolute"}
    if not os.path.exists(candidate):
        return {"valid": False, "reason": "module_folder_missing"}
    if not os.path.isdir(candidate):
        return {"valid": False, "reason": "module_folder_not_a_directory"}
    return {"valid": True, "reason": None}
