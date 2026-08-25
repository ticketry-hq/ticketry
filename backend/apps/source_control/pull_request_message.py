"""Writing the pull request's title and body: preference, fallback, then a template.

The same three-tier shape as the commit subject
(:mod:`apps.source_control.commit_message`) and the same fixed order, because
they answer the same question about the same change set — a configured
preference first, then claude, codex, gemini, opencode, and finally a
deterministic template. Opening a pull request is never blocked on an LLM being
installed.

What differs is the *range*. A commit subject describes the working tree; a
pull request describes the whole branch, so the input is
``<base>..HEAD`` — and the base is resolved to the remote's copy of the branch
where it exists, so a local base branch nobody has updated in a month cannot
inflate the diff with commits the pull request would not actually contain.

Whatever a CLI returns is untrusted prose, not markup this app repeats
verbatim: the first usable line becomes a length-capped title and the rest
becomes a capped body with control characters and fence lines removed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Sequence

from apps.source_control.commit_message import (
    SUBJECT_MAX_CHARS,
    configured_preference,
    generator_sequence,
    sanitize_subject,
)
from apps.source_control.git_cli import run_git
from apps.source_control.message_generators import run_generator


#: How much of the branch's diff a generator is shown. Larger than the commit
#: prompt's budget because a branch is a bigger subject than one commit, and
#: still bounded so a long-lived branch generates in seconds.
PATCH_PROMPT_LIMIT_CHARS = 24_000

#: How many commit subjects the prompt lists, newest first.
COMMIT_SUBJECT_LIMIT = 40

#: How many paths the prompt names before it stops naming them.
SUMMARY_PATH_LIMIT = 60

#: Largest body this app will send to GitHub. A review description is prose;
#: anything past this is a CLI that answered with the diff itself.
BODY_MAX_CHARS = 4_000

_INSTRUCTION = (
    "Write a GitHub pull request title and description for the branch below. "
    "Reply with the title on the first line, then a blank line, then the "
    "description in plain Markdown. The title must be one line, imperative "
    f"mood, no quotes, no prefix, at most {SUBJECT_MAX_CHARS} characters. Do "
    "not include a diff, a code fence, or a heading above the title."
)


@dataclass(frozen=True)
class PullRequestText:
    """The title and body a pull request will carry, and what produced them."""

    title: str
    body: str
    #: A generator name, or ``"template"`` when none of them answered.
    source: str


@dataclass(frozen=True)
class BranchSummary:
    """The branch as the generator and the template both see it."""

    branch: str
    base_branch: str
    #: Commit subjects on this branch and not on its base, newest first.
    subjects: tuple[str, ...]
    paths: tuple[str, ...]
    patch: str


def read_branch_summary(
    repo_path: str, *, branch: str, base_branch: str, remote: str
) -> BranchSummary:
    """Everything this branch adds to its base, capped on the way in."""

    span = _range(repo_path, remote=remote, base_branch=base_branch)
    return BranchSummary(
        branch=branch,
        base_branch=base_branch,
        subjects=_subjects(repo_path, span),
        paths=_paths(repo_path, span),
        patch=_patch(repo_path, span),
    )


def generate_pull_request_text(
    *, repo_path: str, summary: BranchSummary
) -> PullRequestText:
    """The title and body for this pull request, from the first source that answers."""

    prompt = build_prompt(summary)
    for generator in generator_sequence(configured_preference()):
        answer = run_generator(generator, prompt=prompt, cwd=repo_path)
        if answer is None:
            continue
        text = sanitize_answer(answer)
        if text is not None:
            return PullRequestText(
                title=text.title, body=text.body, source=generator.name
            )
    return template_text(summary)


def build_prompt(summary: BranchSummary) -> str:
    """The capped branch description a generator is asked to write about."""

    lines = [
        _INSTRUCTION,
        "",
        f"Branch: {summary.branch}",
        f"Merging into: {summary.base_branch}",
        "",
        "Commits:",
    ]
    lines.extend(f"- {subject}" for subject in summary.subjects)
    if not summary.subjects:
        lines.append("- (none recorded)")
    lines.extend(["", "Files:"])
    lines.extend(f"- {path}" for path in summary.paths)
    trimmed = summary.patch[:PATCH_PROMPT_LIMIT_CHARS]
    if trimmed:
        lines.extend(["", "Patch:", trimmed])
    return "\n".join(lines)


@dataclass(frozen=True)
class _Answer:
    title: str
    body: str


def sanitize_answer(raw: str) -> Optional[_Answer]:
    """One title and body from a CLI's prose, or ``None`` if it gave neither.

    The title goes through the commit subject's own sanitizer, so the two
    surfaces cannot disagree about what "one clean line" means. The body keeps
    its line structure — it is Markdown a reviewer reads — but loses control
    characters, surrounding fences, and anything past the cap.
    """

    lines = raw.splitlines()
    for index, line in enumerate(lines):
        title = sanitize_subject(line)
        if title:
            return _Answer(title=title, body=_sanitize_body(lines[index + 1 :]))
    return None


def _sanitize_body(lines: Sequence[str]) -> str:
    kept = [
        _printable(line)
        for line in lines
        if not line.strip().startswith("```")
    ]
    return "\n".join(kept).strip()[:BODY_MAX_CHARS].strip()


def _printable(line: str) -> str:
    """One line with control characters dropped, tabs kept as spaces."""

    return "".join(
        " " if character == "\t" else character
        for character in line.rstrip()
        if character == "\t" or character >= " "
    )


def template_text(summary: BranchSummary) -> PullRequestText:
    """A deterministic title and body for when no generator is installed.

    Dull and reproducible on purpose: the same branch always yields the same
    text, so a fallback pull request is never mistaken for a generated one.
    """

    return PullRequestText(
        title=_template_title(summary),
        body=_template_body(summary),
        source="template",
    )


def _template_title(summary: BranchSummary) -> str:
    if len(summary.subjects) == 1:
        return summary.subjects[0][:SUBJECT_MAX_CHARS].rstrip(" .")
    if summary.subjects:
        counted = f"{len(summary.subjects)} commits"
    else:
        counted = "changes"
    return f"Merge {counted} from {summary.branch}"[:SUBJECT_MAX_CHARS]


def _template_body(summary: BranchSummary) -> str:
    lines = [
        f"Merging `{summary.branch}` into `{summary.base_branch}`.",
        "",
        "## Commits",
    ]
    lines.extend(f"- {subject}" for subject in summary.subjects)
    if not summary.subjects:
        lines.append("- (none recorded)")
    lines.extend(["", "## Files changed"])
    lines.extend(f"- `{path}`" for path in summary.paths)
    if not summary.paths:
        lines.append("- (none recorded)")
    return "\n".join(lines)[:BODY_MAX_CHARS].strip()


def _range(repo_path: str, *, remote: str, base_branch: str) -> str:
    """``<base>..HEAD``, preferring the remote's copy of the base branch.

    A stale local base branch would put commits into the range that the pull
    request will not contain — the generator would describe work that is
    already merged, and the template would list it.
    """

    for candidate in (
        f"refs/remotes/{remote}/{base_branch}",
        f"refs/heads/{base_branch}",
    ):
        resolved = run_git(
            ["rev-parse", "--verify", "--quiet", candidate],
            cwd=repo_path,
            operation="this pull request's base",
            output_limit_bytes=4096,
            allowed_exit_codes=(0, 1),
        ).stdout.strip()
        if resolved:
            return f"{resolved}..HEAD"
    # No base to subtract at all — a repository whose default branch does not
    # exist locally. Comparing against the empty tree describes the branch's
    # whole content, which is the honest answer to "what would this merge?"
    # and, unlike a bare ``HEAD``, is a range rather than a working-tree diff.
    return f"{_empty_tree(repo_path)}..HEAD"


def _empty_tree(repo_path: str) -> str:
    """This repository's empty-tree object id, asked rather than hardcoded.

    The well-known ``4b825dc…`` is the SHA-1 value; a SHA-256 repository has a
    different one. ``hash-object`` without ``-w`` computes it and writes
    nothing.
    """

    return run_git(
        ["hash-object", "-t", "tree", os.devnull],
        cwd=repo_path,
        operation="this repository's empty tree",
        output_limit_bytes=4096,
    ).stdout.strip()


def _subjects(repo_path: str, span: str) -> tuple[str, ...]:
    listed = run_git(
        ["log", f"--max-count={COMMIT_SUBJECT_LIMIT}", "--format=%s", span],
        cwd=repo_path,
        operation="this branch's commits",
        output_limit_bytes=PATCH_PROMPT_LIMIT_CHARS,
    ).stdout
    return tuple(line.strip() for line in listed.splitlines() if line.strip())


def _paths(repo_path: str, span: str) -> tuple[str, ...]:
    listed = run_git(
        ["diff", "--name-only", "--no-ext-diff", span],
        cwd=repo_path,
        operation="this branch's changed files",
        output_limit_bytes=PATCH_PROMPT_LIMIT_CHARS,
    ).stdout
    paths = [line.strip() for line in listed.splitlines() if line.strip()]
    return tuple(paths[:SUMMARY_PATH_LIMIT])


def _patch(repo_path: str, span: str) -> str:
    return run_git(
        ["diff", "--no-ext-diff", "--no-textconv", span],
        cwd=repo_path,
        operation="this branch's diff",
        output_limit_bytes=PATCH_PROMPT_LIMIT_CHARS,
    ).stdout
