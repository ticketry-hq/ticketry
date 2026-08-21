"""Build a provider adapter's manual entry-skill command."""


def validate_entry_skill_prefix(prefix: str) -> None:
    if prefix not in {"$", "/"}:
        raise ValueError("entry skill prefix must be '$' or '/'")


def format_entry_skill_command(
    entry_skill: str | None,
    *,
    prefix: str,
) -> str | None:
    if entry_skill is None:
        return None
    validate_entry_skill_prefix(prefix)
    return f"{prefix}{entry_skill}"
