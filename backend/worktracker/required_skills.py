"""Pinned upstream skill identifiers accepted by workflow launch bindings."""

from __future__ import annotations

import json
import re
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


def _is_user_invoke_only(identifier: str) -> bool:
    skill_text = (
        files("apps.terminals.agents.skills")
        .joinpath("snapshot", identifier, "SKILL.md")
        .read_text(encoding="utf-8")
    )
    return bool(
        re.search(
            r"(?m)^disable-model-invocation:\s*true\s*$",
            skill_text,
        )
    )


USER_INVOKE_ONLY_SKILL_IDS = frozenset(
    identifier
    for identifier in PINNED_UPSTREAM_SKILL_IDS
    if _is_user_invoke_only(identifier)
)

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
