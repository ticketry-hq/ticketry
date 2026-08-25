"""Which CLI writes the commit subject, and what survives of what it says.

Each case installs real scripts for the headless CLIs and then reads the
subject back out of git, so what is asserted is the commit the repository
actually received.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.settings_store.models import AppSetting
from apps.source_control.messages.commit_message import PREFERENCE_KEY, PREFERENCE_SCOPE
from apps.source_control.tests.commit_fixtures import (
    install_generator,
    isolate_generators,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def post(self, path, *args, **kwargs):
        return super().post(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture
def bin_dir(monkeypatch, tmp_path):
    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def dirty(checkout):
    (checkout / "kept.txt").write_text("one\ntwo\nthree\nfour\n")
    return checkout


def prefer(name: str) -> None:
    AppSetting.objects.update_or_create(
        scope=PREFERENCE_SCOPE,
        key=PREFERENCE_KEY,
        defaults={"value": name, "updated_at": "2026-08-23T00:00:00Z"},
    )


def commit_now() -> dict:
    response = client.post(
        "/worktrees/changes/commit",
        data={"task_id": TASK_ID, "module_id": MODULE_ID},
        content_type="application/json",
    )
    assert response.status_code == 200, response.content
    return response.json()


def head_subject(path) -> str:
    return git(["log", "-1", "--format=%s"], path).stdout.strip()


def install_all(bin_dir) -> None:
    """Every supported CLI installed, each one naming itself."""

    for name in ("claude", "codex", "gemini", "opencode"):
        install_generator(bin_dir, name, prints=f"Subject from {name}")


def test_with_nothing_configured_the_fixed_order_starts_at_claude(dirty, bin_dir):
    install_all(bin_dir)

    assert commit_now()["message_source"] == "claude"
    assert head_subject(dirty) == "Subject from claude"


def test_the_configured_preference_is_tried_ahead_of_the_fixed_order(
    dirty, bin_dir
):
    install_all(bin_dir)
    prefer("gemini")

    body = commit_now()

    assert body["message_source"] == "gemini"
    assert head_subject(dirty) == "Subject from gemini"


@pytest.mark.parametrize(
    ("installed", "expected"),
    [
        (("codex", "gemini", "opencode"), "codex"),
        (("gemini", "opencode"), "gemini"),
        (("opencode",), "opencode"),
    ],
)
def test_generation_falls_back_through_claude_codex_gemini_opencode(
    dirty, bin_dir, installed, expected
):
    for name in installed:
        install_generator(bin_dir, name, prints=f"Subject from {name}")

    assert commit_now()["message_source"] == expected


def test_a_preferred_cli_that_is_not_installed_falls_back_to_the_order(
    dirty, bin_dir
):
    prefer("opencode")
    install_generator(bin_dir, "codex", prints="Subject from codex")

    assert commit_now()["message_source"] == "codex"


def test_an_unrecognised_preference_is_ignored_rather_than_honoured(
    dirty, bin_dir
):
    prefer("some-cli-we-do-not-support")
    install_all(bin_dir)

    assert commit_now()["message_source"] == "claude"


def test_a_generator_that_fails_hands_over_to_the_next_one(dirty, bin_dir):
    install_generator(bin_dir, "claude", prints="never used", exit_code=1)
    install_generator(bin_dir, "codex", prints="Subject from codex")

    assert commit_now()["message_source"] == "codex"


def test_a_generator_that_says_nothing_hands_over_to_the_next_one(dirty, bin_dir):
    install_generator(bin_dir, "claude", prints="   ")
    install_generator(bin_dir, "codex", prints="Subject from codex")

    assert commit_now()["message_source"] == "codex"


def test_every_generator_failing_still_commits_from_the_template(dirty, bin_dir):
    for name in ("claude", "codex", "gemini", "opencode"):
        install_generator(bin_dir, name, exit_code=1)

    body = commit_now()

    assert body["message_source"] == "template"
    assert head_subject(dirty) == "Update kept.txt"


def test_a_chatty_answer_is_reduced_to_one_unquoted_subject_line(dirty, bin_dir):
    install_generator(
        bin_dir,
        "claude",
        prints=(
            "```\n"
            "Subject: \"Extend kept.txt with a fourth line\"\n"
            "\n"
            "This change adds a line so the file has four.\n"
            "```"
        ),
    )

    body = commit_now()

    assert body["subject"] == "Extend kept.txt with a fourth line"
    assert head_subject(dirty) == "Extend kept.txt with a fourth line"


def test_an_overlong_subject_is_capped_at_git_s_subject_width(dirty, bin_dir):
    answer = (
        "Extend the kept text file with one additional line of content so "
        "that the file finally has exactly four lines in it"
    )
    install_generator(bin_dir, "claude", prints=answer)

    subject = commit_now()["subject"]

    assert len(subject) <= 72
    assert "\n" not in subject
    assert subject == head_subject(dirty)
    # A prefix of what was generated, cut on a word boundary rather than
    # mid-word, so the subject still reads as a sentence.
    assert answer.startswith(f"{subject} ")
