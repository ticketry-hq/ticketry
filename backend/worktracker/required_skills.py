"""Pinned upstream skill identifiers accepted by workflow launch bindings."""

from __future__ import annotations

from collections.abc import Iterable


# This is the binding-facing name catalog for the pinned mattpocock/skills
# snapshot. Snapshot acquisition and runtime resolution consume the same
# canonical identifiers; bindings deliberately store names, not resource paths.
PINNED_UPSTREAM_SKILL_IDS = (
    "grill-with-docs",
    "to-spec",
    "to-tickets",
)
_PINNED_UPSTREAM_SKILL_ID_SET = frozenset(PINNED_UPSTREAM_SKILL_IDS)

DEFAULT_REQUIRED_SKILLS = {
    "Idea": ("to-spec", "to-tickets"),
    "Refinement": ("grill-with-docs", "to-spec", "to-tickets"),
}


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
