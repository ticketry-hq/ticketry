"""Writing the commit's subject line: preference, fallback, then a template.

The order is fixed by the HLD. A configured preference is tried first; then
claude, codex, gemini, opencode in that order; and if none of them is installed
or answers, a deterministic template built from the change set itself. A commit
is never blocked on an LLM being present.

Whatever a CLI returns is treated as untrusted prose, not as a commit message:
:func:`sanitize_subject` reduces it to one line, strips the packaging models
habitually add, and caps its length. Only the subject is used — a generated
body is not worth the bytes it would add to every commit in the repository.
"""

from __future__ import annotations

import posixpath
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from apps.source_control.changes.change_status import (
    ADDED,
    CONFLICTED,
    COPIED,
    DELETED,
    RENAMED,
    UNTRACKED,
    ChangedFile,
)
from apps.source_control.messages.message_generators import (
    GENERATOR_ORDER,
    GENERATORS,
    Generator,
    run_generator,
)

#: Where the host records which CLI to try first.
PREFERENCE_SCOPE = "host"
PREFERENCE_KEY = "source_control_message_generator"

#: Git's own convention, and what every review tool wraps at.
SUBJECT_MAX_CHARS = 72

#: How much of the staged patch a generator is shown. Enough for it to see what
#: changed; small enough that a large commit still generates in seconds.
PATCH_PROMPT_LIMIT_CHARS = 12_000

#: How many paths the prompt's summary lists before it stops naming them.
SUMMARY_PATH_LIMIT = 40

_INSTRUCTION = (
    "Write a git commit subject line for the changes below. Reply with the "
    "subject line only: one line, imperative mood, no quotes, no Markdown, no "
    f"prefix, at most {SUBJECT_MAX_CHARS} characters. Do not explain."
)

#: Labels a model prepends when it answers with more than was asked for.
#: Longest first, so a prefix never shadows the label that contains it. The
#: pull-request wordings are here rather than in that module because the two
#: surfaces share this sanitizer, and a title labelled by a model is the same
#: problem whichever of them asked for it.
_LABELS = (
    "pull request title:",
    "commit subject:",
    "commit message:",
    "subject line:",
    "pr title:",
    "subject:",
    "message:",
    "title:",
)

_STATUS_VERBS = {
    UNTRACKED: "Add",
    ADDED: "Add",
    DELETED: "Remove",
    RENAMED: "Rename",
    COPIED: "Copy",
    CONFLICTED: "Resolve",
}


@dataclass(frozen=True)
class GeneratedMessage:
    """The subject a commit will carry, and which source produced it."""

    subject: str
    #: A generator name, or ``"template"`` when none of them answered.
    source: str


def configured_preference() -> Optional[str]:
    """The generator the host asked for, if it named a supported one."""

    from apps.settings_store.models import AppSetting

    value = (
        AppSetting.objects.filter(scope=PREFERENCE_SCOPE, key=PREFERENCE_KEY)
        .values_list("value", flat=True)
        .first()
    )
    if not value:
        return None
    name = value.strip().strip('"').strip().lower()
    return name if name in GENERATORS else None


def generator_sequence(preference: Optional[str]) -> tuple[Generator, ...]:
    """The preference first, then the fixed order with no repeats."""

    names = list(GENERATOR_ORDER)
    if preference in GENERATORS:
        names.remove(preference)
        names.insert(0, preference)
    return tuple(GENERATORS[name] for name in names)


def sanitize_subject(raw: str) -> Optional[str]:
    """One capped subject line from a CLI's answer, or ``None`` if unusable."""

    for line in raw.splitlines():
        candidate = _strip_packaging(line)
        if candidate:
            return _capped(candidate)
    return None


def _strip_packaging(line: str) -> str:
    text = line.strip()
    # Fenced output: the fence itself carries nothing.
    if text.startswith("```"):
        return ""
    # A leading bullet, blockquote, or heading marker.
    text = text.lstrip("#>-*• \t")
    lowered = text.lower()
    for label in _LABELS:
        if lowered.startswith(label):
            text = text[len(label) :].strip()
            break
    text = text.strip().strip("`")
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    return " ".join(text.split())


def _capped(subject: str) -> str:
    """Cap at git's subject width, cutting on a word boundary when there is one."""

    if len(subject) <= SUBJECT_MAX_CHARS:
        return subject.rstrip(" .")
    clipped = subject[:SUBJECT_MAX_CHARS]
    boundary = clipped.rfind(" ")
    if boundary >= SUBJECT_MAX_CHARS // 2:
        clipped = clipped[:boundary]
    return clipped.rstrip(" .,;:-")


def build_prompt(files: Sequence[ChangedFile], patch: str) -> str:
    """The capped summary and patch a generator is asked to describe."""

    lines = [_INSTRUCTION, "", "Files:"]
    for changed in files[:SUMMARY_PATH_LIMIT]:
        lines.append(f"- {changed.status} {changed.path}")
    remaining = len(files) - SUMMARY_PATH_LIMIT
    if remaining > 0:
        lines.append(f"- and {remaining} more")
    trimmed = patch[:PATCH_PROMPT_LIMIT_CHARS]
    if trimmed:
        lines.extend(["", "Patch:", trimmed])
    return "\n".join(lines)


def template_subject(files: Sequence[ChangedFile]) -> str:
    """A deterministic subject for when no generator is installed.

    Deliberately dull and reproducible: the same change set always yields the
    same line, so a fallback commit is never mistaken for a generated one.
    """

    if not files:
        return "Update working tree"
    if len(files) == 1:
        changed = files[0]
        verb = _STATUS_VERBS.get(changed.status, "Update")
        return _capped(f"{verb} {changed.path}")
    location = _common_directory(changed.path for changed in files)
    counted = f"Update {len(files)} files"
    return _capped(f"{counted} in {location}" if location else counted)


def _common_directory(paths: Iterable[str]) -> str:
    """The deepest directory every path shares, or ``""`` at the root."""

    directories = [posixpath.dirname(path) for path in paths]
    if not directories or any(directory == "" for directory in directories):
        return ""
    shared = directories[0].split("/")
    for directory in directories[1:]:
        segments = directory.split("/")
        kept = 0
        while (
            kept < len(shared)
            and kept < len(segments)
            and shared[kept] == segments[kept]
        ):
            kept += 1
        shared = shared[:kept]
        if not shared:
            return ""
    return "/".join(shared)


def generate_commit_subject(
    *,
    repo_path: str,
    files: Sequence[ChangedFile],
    patch: str,
) -> GeneratedMessage:
    """The subject for this commit, from the first source that answers."""

    prompt = build_prompt(files, patch)
    for generator in generator_sequence(configured_preference()):
        answer = run_generator(generator, prompt=prompt, cwd=repo_path)
        if answer is None:
            continue
        subject = sanitize_subject(answer)
        if subject:
            return GeneratedMessage(subject=subject, source=generator.name)
    return GeneratedMessage(subject=template_subject(files), source="template")
