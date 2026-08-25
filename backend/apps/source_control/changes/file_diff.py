"""The working-tree diff for one changed file.

Reading a diff never takes a path straight from the caller: the requested path
must already appear in the checkout's change set, which both bounds what can
be read and gives the read the file's status. Untracked files have nothing in
HEAD to diff against, so they go through ``--no-index`` against an empty file;
everything else diffs against HEAD, passing the pre-rename path too so a
rename renders as a rename rather than a whole-file add.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from apps.source_control.changes.change_status import (
    UNTRACKED,
    ChangedFile,
)
from apps.source_control.clients.git_cli import run_git

#: One file's patch is capped well below the general output cap: a review
#: surface that has to scroll a megabyte of diff has stopped being a review.
DIFF_OUTPUT_LIMIT_BYTES = 512 * 1024


@dataclass(frozen=True)
class FileDiff:
    path: str
    status: str
    binary: bool
    patch: str
    truncated: bool


def _trim_to_last_line(patch: str) -> str:
    """Drop a trailing partial line so a capped patch still parses."""

    cut = patch.rfind("\n")
    return patch[: cut + 1] if cut != -1 else ""


def read_file_diff(repo_path: str, changed: ChangedFile) -> FileDiff:
    """The unified working-tree diff for ``changed``, bounded and truncatable."""

    if changed.status == UNTRACKED:
        args = [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--",
            os.devnull,
            changed.path,
        ]
        # --no-index reports "files differ" as exit 1, which is the normal
        # outcome here rather than a failure.
        allowed = (0, 1)
    else:
        paths = [changed.path]
        if changed.original_path:
            paths.append(changed.original_path)
        args = ["diff", "HEAD", "--no-ext-diff", "--no-textconv", "--", *paths]
        allowed = (0,)

    result = run_git(
        args,
        cwd=repo_path,
        operation=f"the diff for {changed.path}",
        output_limit_bytes=DIFF_OUTPUT_LIMIT_BYTES,
        allowed_exit_codes=allowed,
    )
    patch = (
        _trim_to_last_line(result.stdout) if result.truncated else result.stdout
    )
    return FileDiff(
        path=changed.path,
        status=changed.status,
        binary=changed.binary,
        patch=patch,
        truncated=result.truncated,
    )
