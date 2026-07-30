"""Pinned upstream skill identifiers accepted by workflow launch bindings."""

from __future__ import annotations

import json
from collections.abc import Iterable
from importlib.resources import files

from worktracker.reviewed_defaults import REVIEWED_REQUIRED_SKILLS


_PINNED_UPSTREAM_SKILL_LOCK = json.loads(
    files("apps.terminals.agents.skills")
    .joinpath("lock.json")
    .read_text(encoding="utf-8")
)
PINNED_UPSTREAM_SKILL_IDS = tuple(_PINNED_UPSTREAM_SKILL_LOCK["selected_packages"])
_PINNED_UPSTREAM_SKILL_ID_SET = frozenset(PINNED_UPSTREAM_SKILL_IDS)

DEFAULT_REQUIRED_SKILLS = REVIEWED_REQUIRED_SKILLS


class RequiredSkillsValidationError(ValueError):
    """A launch binding declares invalid pinned-snapshot requirements."""


def normalize_required_skills(values: Iterable[str] | None) -> list[str]:
    """Validate and return requirements without changing their order."""

    required_skills = list(values or ())
    seen: set[str] = set()
    for identifier in required_skills:
        if identifier not in _PINNED_UPSTREAM_SKILL_ID_SET:
            raise RequiredSkillsValidationError(
                f"Required skill '{identifier}' is not in the pinned upstream snapshot."
            )
        if identifier in seen:
            raise RequiredSkillsValidationError(
                f"Required skill '{identifier}' is declared more than once."
            )
        seen.add(identifier)
    return required_skills
