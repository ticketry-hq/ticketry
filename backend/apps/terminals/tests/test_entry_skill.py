import pytest

from apps.terminals.entry_skill import format_entry_skill_command


@pytest.mark.parametrize(
    ("prefix", "expected"),
    (("/", "/to-spec"), ("$", "$to-spec")),
)
def test_entry_skill_command_is_one_provider_specific_line(prefix, expected):
    assert format_entry_skill_command("to-spec", prefix=prefix) == expected


def test_binding_without_entry_skill_has_no_manual_terminal_command():
    assert format_entry_skill_command(None, prefix="/") is None


def test_entry_skill_command_rejects_unknown_prefix():
    with pytest.raises(ValueError, match="entry skill prefix"):
        format_entry_skill_command("to-spec", prefix="!")
