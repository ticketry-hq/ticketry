"""Build a provider adapter's manual entry-skill command."""


def format_entry_skill_command(
    entry_skill: str | None,
    *,
    prefix: str,
) -> str | None:
    if entry_skill is None:
        return None
    if prefix not in {"$", "/"}:
        raise ValueError("entry skill prefix must be '$' or '/'")
    return f"{prefix}{entry_skill}"
