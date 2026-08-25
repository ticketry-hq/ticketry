"""One working-tree change set: which files differ from HEAD, and by how much.

Two bounded reads build it — ``git status`` for the file list and its states,
``git diff HEAD --numstat`` for per-file insertion and deletion counts — plus
a local count for untracked files, which numstat cannot see. Both reads share
the caps in :mod:`apps.source_control.clients.git_cli`; a status that overflows the
output cap is refused outright rather than listed partially, because a
truncated file list reads as a complete one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from apps.source_control.changes.untracked_counts import count_untracked_file
from apps.source_control.clients import git_cli
from apps.source_control.clients.git_cli import run_git
from apps.source_control.errors import ChangesTooLarge

UNTRACKED = "untracked"
ADDED = "added"
MODIFIED = "modified"
DELETED = "deleted"
RENAMED = "renamed"
COPIED = "copied"
CONFLICTED = "conflicted"

#: Every state the review surface can report, in the order git reaches them.
CHANGE_STATUS_CHOICES = (
    (UNTRACKED, "Untracked"),
    (ADDED, "Added"),
    (MODIFIED, "Modified"),
    (DELETED, "Deleted"),
    (RENAMED, "Renamed"),
    (COPIED, "Copied"),
    (CONFLICTED, "Conflicted"),
)

# git's own unmerged index/worktree pairs (see git-status(1), "Short Format").
_UNMERGED = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}


@dataclass(frozen=True)
class ChangedFile:
    """One path that differs between HEAD and the working tree."""

    path: str
    status: str
    #: Pre-rename path, for renames and copies only.
    original_path: Optional[str]
    binary: bool
    #: ``None`` for binary content, where line counts are meaningless.
    insertions: Optional[int]
    deletions: Optional[int]


@dataclass(frozen=True)
class ChangeSet:
    files: list[ChangedFile]
    insertions: int
    deletions: int

    @property
    def dirty(self) -> bool:
        return bool(self.files)


def _split_records(raw: str) -> list[str]:
    """NUL-separated fields, with the trailing terminator dropped."""

    fields = raw.split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    return fields


def classify(index_state: str, worktree_state: str) -> str:
    """Collapse git's two-axis short status into one reviewer-facing state.

    The review surface commits everything, so "staged" versus "unstaged" is
    not a distinction a reviewer can act on; only what happened to the file is.
    """

    pair = f"{index_state}{worktree_state}"
    if pair == "??":
        return UNTRACKED
    if pair in _UNMERGED:
        return CONFLICTED
    if index_state == "R":
        return RENAMED
    if index_state == "C":
        return COPIED
    if "D" in pair:
        return DELETED
    if index_state == "A":
        return ADDED
    return MODIFIED


def _read_status(repo_path: str) -> list[tuple[str, str, Optional[str]]]:
    """``(status, path, original_path)`` for every changed path."""

    result = run_git(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd=repo_path,
        operation="this checkout's status",
    )
    if result.truncated:
        raise ChangesTooLarge(
            output_limit_bytes=git_cli.DEFAULT_OUTPUT_LIMIT_BYTES
        )

    fields = _split_records(result.stdout)
    entries: list[tuple[str, str, Optional[str]]] = []
    index = 0
    while index < len(fields):
        record = fields[index]
        index += 1
        if len(record) < 4:
            continue
        state = classify(record[0], record[1])
        path = record[3:]
        original: Optional[str] = None
        if state in (RENAMED, COPIED) and index < len(fields):
            original = fields[index]
            index += 1
        entries.append((state, path, original))
    return entries


def _read_numstat(repo_path: str) -> dict[str, tuple[Optional[int], Optional[int]]]:
    """Per-path insertion/deletion counts against HEAD; ``None`` when binary."""

    result = run_git(
        ["diff", "HEAD", "--numstat", "-z", "--no-ext-diff", "--no-textconv"],
        cwd=repo_path,
        operation="this checkout's change counts",
        # A worktree cut before its first commit has no HEAD to diff against;
        # every file there is simply untracked, and counted as such below.
        allowed_exit_codes=(0, 128),
    )
    if result.truncated:
        raise ChangesTooLarge(
            output_limit_bytes=git_cli.DEFAULT_OUTPUT_LIMIT_BYTES
        )

    fields = _split_records(result.stdout)
    counts: dict[str, tuple[Optional[int], Optional[int]]] = {}
    index = 0
    while index < len(fields):
        record = fields[index]
        index += 1
        parts = record.split("\t")
        if len(parts) < 3:
            continue
        added, removed, path = parts[0], parts[1], parts[2]
        if path == "":
            # Rename or copy: the source and destination follow as fields.
            if index + 1 >= len(fields):
                break
            path = fields[index + 1]
            index += 2
        binary = added == "-" or removed == "-"
        counts[path] = (
            (None, None)
            if binary
            else (_as_int(added), _as_int(removed))
        )
    return counts


def _as_int(value: str) -> Optional[int]:
    try:
        return int(value)
    except ValueError:
        return None


def collect_changes(repo_path: str) -> ChangeSet:
    """Every working-tree difference from HEAD, sorted by path."""

    counts = _read_numstat(repo_path)
    files: list[ChangedFile] = []
    for state, path, original in _read_status(repo_path):
        if state == UNTRACKED:
            counted = count_untracked_file(os.path.join(repo_path, path))
            if counted is None:
                files.append(
                    ChangedFile(path, state, None, False, None, None)
                )
                continue
            files.append(
                ChangedFile(
                    path=path,
                    status=state,
                    original_path=None,
                    binary=counted.binary,
                    insertions=None if counted.binary else counted.lines,
                    deletions=None if counted.binary else 0,
                )
            )
            continue
        # numstat reports binary content as "-\t-", which this read already
        # turned into a pair of Nones; a path numstat never mentioned at all
        # (an unmerged file, say) is simply uncounted, not binary.
        counted = counts.get(path)
        insertions, deletions = counted if counted else (None, None)
        files.append(
            ChangedFile(
                path=path,
                status=state,
                original_path=original,
                binary=counted is not None and insertions is None,
                insertions=insertions,
                deletions=deletions,
            )
        )

    files.sort(key=lambda changed: changed.path)
    return ChangeSet(
        files=files,
        insertions=sum(changed.insertions or 0 for changed in files),
        deletions=sum(changed.deletions or 0 for changed in files),
    )
