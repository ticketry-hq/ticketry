"""What a pull request's title and body come out as, whatever a CLI answered.

The generator itself is exercised through the endpoint
(``test_pull_request_api``); what is tested here is the part that has to hold
for prose nobody controls: a model that answers with a fence, a label, a
paragraph where a title was asked for, or a page where a description was asked
for still yields one clean title and a bounded body — or yields nothing, so the
caller falls through to the next generator rather than committing to a bad
answer.
"""

from __future__ import annotations

from apps.source_control.messages.commit_message import SUBJECT_MAX_CHARS
from apps.source_control.messages.pull_request_message import (
    BODY_MAX_CHARS,
    BranchSummary,
    build_prompt,
    sanitize_answer,
    template_text,
)


def summary(**overrides) -> BranchSummary:
    defaults = dict(
        branch="CODIN-984-open-a-pull-request",
        base_branch="main",
        subjects=("Add the provider step", "Cap the generated body"),
        paths=("backend/apps/source_control/pull_request.py",),
        patch="diff --git a/x b/x\n+one\n",
    )
    return BranchSummary(**{**defaults, **overrides})


def test_the_first_line_becomes_the_title_and_the_rest_becomes_the_body():
    answer = sanitize_answer(
        "Open a pull request from a worktree\n\nWhy this exists.\n\n- one\n- two"
    )

    assert answer is not None
    assert answer.title == "Open a pull request from a worktree"
    assert answer.body == "Why this exists.\n\n- one\n- two"


def test_packaging_a_model_adds_is_stripped_from_the_title():
    answer = sanitize_answer("```\nTitle: Ship the provider step\n```\nThe body.")

    assert answer is not None
    assert answer.title == "Ship the provider step"
    # The fence lines are markup the model added, not content a reviewer wants.
    assert "```" not in answer.body
    assert answer.body == "The body."


def test_a_long_title_is_capped_at_gits_subject_width():
    answer = sanitize_answer(f"{'word ' * 40}\n\nBody.")

    assert answer is not None
    assert len(answer.title) <= SUBJECT_MAX_CHARS


def test_a_body_longer_than_the_cap_is_truncated():
    answer = sanitize_answer("A title\n\n" + ("x" * (BODY_MAX_CHARS * 2)))

    assert answer is not None
    assert len(answer.body) == BODY_MAX_CHARS


def test_control_characters_never_reach_the_body():
    answer = sanitize_answer("A title\n\nline one\x07\x00\nline\ttwo")

    assert answer is not None
    assert "\x07" not in answer.body
    assert "\x00" not in answer.body
    assert "line\ttwo" not in answer.body
    assert "line two" in answer.body


def test_an_answer_with_no_usable_line_is_no_answer():
    """``None`` is what makes the fallback order work.

    A generator that printed only a fence, or only whitespace, has to read as
    "did not answer" so the next one is tried — not as an empty title that
    would be sent to GitHub.
    """

    assert sanitize_answer("```\n```\n   \n") is None
    assert sanitize_answer("") is None


def test_the_template_is_deterministic_and_names_the_branch_and_base():
    first = template_text(summary())
    second = template_text(summary())

    assert first == second
    assert first.source == "template"
    assert "CODIN-984-open-a-pull-request" in first.body
    assert "main" in first.body
    assert "Add the provider step" in first.body


def test_the_template_uses_a_single_commits_subject_as_the_title():
    text = template_text(summary(subjects=("Add the provider step",)))

    assert text.title == "Add the provider step"


def test_the_template_counts_commits_when_there_is_more_than_one():
    text = template_text(summary())

    assert text.title == "Merge 2 commits from CODIN-984-open-a-pull-request"


def test_the_template_still_writes_something_for_a_branch_with_no_commits():
    text = template_text(summary(subjects=(), paths=()))

    assert text.title
    assert "(none recorded)" in text.body


def test_the_prompt_carries_the_branch_its_base_and_a_capped_patch():
    prompt = build_prompt(summary(patch="p" * 100_000))

    assert "CODIN-984-open-a-pull-request" in prompt
    assert "Merging into: main" in prompt
    assert "Add the provider step" in prompt
    # The patch is capped on the way in, so a long-lived branch still generates
    # in seconds rather than sending a repository to a CLI.
    assert len(prompt) < 100_000
